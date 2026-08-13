import type { ModelData, ModelPreset, TensorGraph, TensorNode } from "./types";

export const PRESETS: ModelPreset[] = [
  {
    id: "pocket",
    label: "Pocket MLP",
    description: "Fast correctness loop",
    batch: 4,
    input: 64,
    hidden: 96,
    output: 32
  },
  {
    id: "standard",
    label: "Encoder block",
    description: "Balanced browser workload",
    batch: 8,
    input: 128,
    hidden: 256,
    output: 64
  },
  {
    id: "stress",
    label: "Wide projection",
    description: "Expose dispatch and memory cost",
    batch: 16,
    input: 256,
    hidden: 512,
    output: 128
  }
];

const bytesFor = (shape: number[]) => shape.reduce((total, value) => total * value, 1) * 4;

const node = (
  id: string,
  label: string,
  op: TensorNode["op"],
  inputs: string[],
  shape: number[],
  attrs?: TensorNode["attrs"]
): TensorNode => ({ id, label, op, inputs, shape, dtype: "f32", bytes: bytesFor(shape), attrs });

export function createDemoGraph(preset: ModelPreset): TensorGraph {
  const { batch: b, input: i, hidden: h, output: o } = preset;
  return {
    name: `${preset.label} / two-layer projection`,
    outputs: ["probabilities"],
    nodes: [
      node("input", "Input tokens", "input", [], [b, i]),
      node("weight1", "Projection W₁", "parameter", [], [i, h]),
      node("bias1", "Bias b₁", "parameter", [], [1, h]),
      node("matmul1", "MatMul", "matmul", ["input", "weight1"], [b, h]),
      node("add1", "Bias add", "add", ["matmul1", "bias1"], [b, h]),
      node("gelu1", "GELU", "gelu", ["add1"], [b, h]),
      node("identity", "Layout identity", "identity", ["gelu1"], [b, h]),
      node("weight2", "Projection W₂", "parameter", [], [h, o]),
      node("bias2", "Bias b₂", "parameter", [], [1, o]),
      node("matmul2", "MatMul", "matmul", ["identity", "weight2"], [b, o]),
      node("add2", "Bias add", "add", ["matmul2", "bias2"], [b, o]),
      node("probabilities", "Softmax", "softmax", ["add2"], [b, o]),
      node("debug", "Training debug tap", "debugTap", ["gelu1"], [b, h])
    ]
  };
}

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function fill(count: number, random: () => number, scale: number) {
  const values = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = (random() * 2 - 1) * scale;
  }
  return values;
}

export function createModelData(preset: ModelPreset, seed = 53826): ModelData {
  const random = lcg(seed + preset.batch + preset.hidden);
  return {
    input: fill(preset.batch * preset.input, random, 0.8),
    weight1: fill(preset.input * preset.hidden, random, 0.12),
    bias1: fill(preset.hidden, random, 0.04),
    weight2: fill(preset.hidden * preset.output, random, 0.12),
    bias2: fill(preset.output, random, 0.04)
  };
}
