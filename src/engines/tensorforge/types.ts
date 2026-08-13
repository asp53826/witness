export type DType = "f32";

export type OpKind =
  | "input"
  | "parameter"
  | "identity"
  | "matmul"
  | "add"
  | "gelu"
  | "softmax"
  | "debugTap"
  | "fusedLinearGelu"
  | "fusedLinear";

export interface TensorNode {
  id: string;
  label: string;
  op: OpKind;
  inputs: string[];
  shape: number[];
  dtype: DType;
  bytes: number;
  attrs?: Record<string, number | string | boolean>;
}

export interface TensorGraph {
  name: string;
  nodes: TensorNode[];
  outputs: string[];
}

export interface ModelPreset {
  id: "pocket" | "standard" | "stress";
  label: string;
  description: string;
  batch: number;
  input: number;
  hidden: number;
  output: number;
}

export interface CompilerOptions {
  fusion: boolean;
  memoryReuse: boolean;
}

export interface Allocation {
  nodeId: string;
  slot: number;
  bytes: number;
  start: number;
  end: number;
  persistent: boolean;
}

export interface MemoryPlan {
  allocations: Allocation[];
  naiveBytes: number;
  plannedBytes: number;
  peakTransientBytes: number;
  persistentBytes: number;
  slots: number;
}

export interface PassStats {
  nodes: number;
  kernels: number;
  transientBytes: number;
  removed: number;
  fused: number;
}

export interface PassSnapshot {
  id: string;
  name: string;
  action: string;
  detail: string;
  graph: TensorGraph;
  stats: PassStats;
  memory?: MemoryPlan;
}

export interface Compilation {
  snapshots: PassSnapshot[];
  finalGraph: TensorGraph;
  memory: MemoryPlan;
}

export interface ModelData {
  input: Float32Array;
  weight1: Float32Array;
  bias1: Float32Array;
  weight2: Float32Array;
  bias2: Float32Array;
}

export interface ExecutionResult {
  output: Float32Array;
  milliseconds: number;
}
