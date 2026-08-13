import type {
  Allocation,
  Compilation,
  CompilerOptions,
  MemoryPlan,
  PassSnapshot,
  PassStats,
  TensorGraph,
  TensorNode
} from "./types";

const cloneGraph = (graph: TensorGraph): TensorGraph => ({
  ...graph,
  nodes: graph.nodes.map((node) => ({ ...node, inputs: [...node.inputs], shape: [...node.shape] }))
});

const kernelOps = new Set<TensorNode["op"]>([
  "identity",
  "matmul",
  "add",
  "gelu",
  "softmax",
  "debugTap",
  "fusedLinearGelu",
  "fusedLinear"
]);

function stats(graph: TensorGraph, removed = 0, fused = 0): PassStats {
  return {
    nodes: graph.nodes.length,
    kernels: graph.nodes.filter((node) => kernelOps.has(node.op)).length,
    transientBytes: graph.nodes
      .filter((node) => node.op !== "parameter")
      .reduce((total, node) => total + node.bytes, 0),
    removed,
    fused
  };
}

function snapshot(
  id: string,
  name: string,
  action: string,
  detail: string,
  graph: TensorGraph,
  removed = 0,
  fused = 0,
  memory?: MemoryPlan
): PassSnapshot {
  return { id, name, action, detail, graph: cloneGraph(graph), stats: stats(graph, removed, fused), memory };
}

function byId(graph: TensorGraph, id: string) {
  const found = graph.nodes.find((node) => node.id === id);
  if (!found) throw new Error(`TensorForge IR references missing node: ${id}`);
  return found;
}

export function validateAndInfer(graph: TensorGraph): TensorGraph {
  const next = cloneGraph(graph);
  for (const current of next.nodes) {
    for (const input of current.inputs) byId(next, input);
    if (current.shape.some((dimension) => !Number.isInteger(dimension) || dimension <= 0)) {
      throw new Error(`${current.id} has an invalid tensor shape`);
    }
    if (current.op === "matmul") {
      const left = byId(next, current.inputs[0] ?? "");
      const right = byId(next, current.inputs[1] ?? "");
      if (left.shape.length !== 2 || right.shape.length !== 2 || left.shape[1] !== right.shape[0]) {
        throw new Error(`${current.id} cannot multiply [${left.shape}] by [${right.shape}]`);
      }
      current.shape = [left.shape[0] ?? 0, right.shape[1] ?? 0];
      current.bytes = (current.shape[0] ?? 0) * (current.shape[1] ?? 0) * 4;
    }
  }
  return next;
}

export function canonicalize(graph: TensorGraph): TensorGraph {
  const next = cloneGraph(graph);
  const identities = new Map(
    next.nodes.filter((node) => node.op === "identity").map((node) => [node.id, node.inputs[0] ?? ""])
  );
  next.nodes = next.nodes
    .filter((node) => node.op !== "identity")
    .map((node) => ({
      ...node,
      inputs: node.inputs.map((input) => identities.get(input) ?? input)
    }));
  next.outputs = next.outputs.map((output) => identities.get(output) ?? output);
  return next;
}

export function fuseLinearPatterns(graph: TensorGraph): TensorGraph {
  const next = cloneGraph(graph);
  const consumed = new Set<string>();
  const replacements = new Map<string, TensorNode>();

  const gelu = next.nodes.find((node) => node.op === "gelu");
  if (gelu) {
    const add = byId(next, gelu.inputs[0] ?? "");
    const matmul = add.op === "add" ? byId(next, add.inputs[0] ?? "") : undefined;
    if (add.op === "add" && matmul?.op === "matmul") {
      consumed.add(matmul.id);
      consumed.add(add.id);
      replacements.set(gelu.id, {
        ...gelu,
        label: "Fused linear + GELU",
        op: "fusedLinearGelu",
        inputs: [matmul.inputs[0] ?? "", matmul.inputs[1] ?? "", add.inputs[1] ?? ""]
      });
    }
  }

  for (const add of next.nodes.filter((node) => node.op === "add" && !consumed.has(node.id))) {
    const matmul = byId(next, add.inputs[0] ?? "");
    if (matmul.op === "matmul") {
      consumed.add(matmul.id);
      replacements.set(add.id, {
        ...add,
        label: "Fused linear",
        op: "fusedLinear",
        inputs: [matmul.inputs[0] ?? "", matmul.inputs[1] ?? "", add.inputs[1] ?? ""]
      });
    }
  }

  next.nodes = next.nodes
    .filter((node) => !consumed.has(node.id))
    .map((node) => replacements.get(node.id) ?? node);
  return next;
}

export function eliminateDeadCode(graph: TensorGraph): TensorGraph {
  const next = cloneGraph(graph);
  const live = new Set<string>();
  const visit = (id: string) => {
    if (live.has(id)) return;
    live.add(id);
    for (const input of byId(next, id).inputs) visit(input);
  };
  for (const output of next.outputs) visit(output);
  next.nodes = next.nodes.filter((node) => live.has(node.id));
  return next;
}

export function planMemory(graph: TensorGraph, allowReuse: boolean): MemoryPlan {
  const positions = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const lastUse = new Map(graph.nodes.map((node) => [node.id, positions.get(node.id) ?? 0]));
  for (const [index, node] of graph.nodes.entries()) {
    for (const input of node.inputs) lastUse.set(input, Math.max(lastUse.get(input) ?? 0, index));
  }
  for (const output of graph.outputs) lastUse.set(output, graph.nodes.length);

  const allocations: Allocation[] = [];
  const slotCapacity: number[] = [];
  const persistentSlots = new Set<number>();
  const active = new Map<number, number>();
  let peakTransientBytes = 0;

  for (const [index, node] of graph.nodes.entries()) {
    for (const [slot, end] of [...active.entries()]) {
      if (end < index) active.delete(slot);
    }
    const persistent = node.op === "parameter";
    let slot = slotCapacity.length;
    if (allowReuse && !persistent) {
      const reusable = slotCapacity.findIndex(
        (capacity, candidate) => !persistentSlots.has(candidate) && !active.has(candidate) && capacity >= node.bytes
      );
      if (reusable >= 0) slot = reusable;
    }
    if (slot === slotCapacity.length) slotCapacity.push(node.bytes);
    else slotCapacity[slot] = Math.max(slotCapacity[slot] ?? 0, node.bytes);
    const end = persistent ? graph.nodes.length : lastUse.get(node.id) ?? index;
    allocations.push({ nodeId: node.id, slot, bytes: node.bytes, start: index, end, persistent });
    if (persistent) persistentSlots.add(slot);
    if (!persistent) active.set(slot, end);
    const activeBytes = [...active.keys()].reduce((total, activeSlot) => total + (slotCapacity[activeSlot] ?? 0), 0);
    peakTransientBytes = Math.max(peakTransientBytes, activeBytes);
  }

  const persistentBytes = graph.nodes
    .filter((node) => node.op === "parameter")
    .reduce((total, node) => total + node.bytes, 0);
  const naiveBytes = graph.nodes.reduce((total, node) => total + node.bytes, 0);
  return {
    allocations,
    naiveBytes,
    plannedBytes: allowReuse ? persistentBytes + peakTransientBytes : naiveBytes,
    peakTransientBytes,
    persistentBytes,
    slots: slotCapacity.length
  };
}

export function compileGraph(source: TensorGraph, options: CompilerOptions): Compilation {
  const snapshots: PassSnapshot[] = [];
  const original = cloneGraph(source);
  snapshots.push(snapshot("source", "Source graph", "Parse", "Loaded typed tensor operations and parameters.", original));

  const inferred = validateAndInfer(original);
  snapshots.push(snapshot("infer", "Shape inference", "Verify", "Propagated ranks and rejected incompatible matrix dimensions.", inferred));

  const canonical = canonicalize(inferred);
  snapshots.push(snapshot("canonical", "Canonicalize", "Rewrite", "Removed identity-only layout edges before scheduling.", canonical, inferred.nodes.length - canonical.nodes.length));

  const fused = options.fusion ? fuseLinearPatterns(canonical) : canonical;
  snapshots.push(snapshot(
    "fusion",
    "Operator fusion",
    options.fusion ? "Fuse" : "Bypass",
    options.fusion ? "Collapsed linear, bias, and activation patterns into fewer GPU dispatches." : "Fusion disabled; primitive kernels remain visible.",
    fused,
    canonical.nodes.length - fused.nodes.length,
    options.fusion ? 2 : 0
  ));

  const live = eliminateDeadCode(fused);
  snapshots.push(snapshot("dce", "Dead-code elimination", "Prune", "Traced outputs backward and removed the unused training debug tap.", live, fused.nodes.length - live.nodes.length));

  const memory = planMemory(live, options.memoryReuse);
  snapshots.push(snapshot(
    "memory",
    "Memory planning",
    options.memoryReuse ? "Reuse" : "Allocate",
    options.memoryReuse ? "Reused transient slots after their final consumer." : "Assigned an independent buffer to every tensor.",
    live,
    0,
    0,
    memory
  ));
  return { snapshots, finalGraph: live, memory };
}
