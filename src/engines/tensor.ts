import { validateAndInfer } from './tensorforge/compiler'
import { createDemoGraph, PRESETS } from './tensorforge/models'
import type { RunResult } from '../types'

export async function runTensorForge(): Promise<RunResult> {
  const preset = PRESETS.find((candidate) => candidate.id === 'standard')!
  const graph = createDemoGraph(preset)
  const weight = graph.nodes.find((node) => node.id === 'weight1')!
  const original = [...weight.shape]
  weight.shape = [127, preset.hidden]
  let error = ''
  try { validateAndInfer(graph) } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
  const expected = 'matmul1 cannot multiply [8,128] by [127,256]'
  const passed = error === expected
  return {
    passed,
    summary: passed ? 'Shape mismatch rejected before fusion, allocation, WGSL generation, or GPU dispatch.' : 'Compiler rejection did not match the pinned oracle.',
    metrics: [
      { label: 'INPUT', value: '[8,128]', tone: 'neutral' },
      { label: 'W₁ MUTATION', value: `[${original}] → [${weight.shape}]`, tone: 'warn' },
      { label: 'GPU DISPATCH', value: '0', tone: passed ? 'good' : 'warn' },
      { label: 'REJECTION', value: passed ? 'EXACT' : 'MISMATCH', tone: passed ? 'good' : 'warn' },
    ],
    trace: [`Loaded ${graph.name}.`, `Mutated weight1 contracting dimension ${original[0]} → ${weight.shape[0]}.`, 'Entered validateAndInfer() on a cloned typed graph.', error || 'No compiler error was raised.', `Expected exact diagnostic matched=${passed}.`],
    raw: { expected, observed: error, originalShape: original, mutatedShape: weight.shape },
  }
}
