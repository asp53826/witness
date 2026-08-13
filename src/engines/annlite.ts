import type { RunResult } from '../types'

interface AnnFrontierPoint { ef: number; recall: number; meanComputations: number }
interface AnnObservation {
  engine: string
  passed: boolean
  vectors: number
  dimensions: number
  queries: number
  k: number
  recallMonotone: boolean
  workMonotone: boolean
  frontier: AnnFrontierPoint[]
}
interface AnnliteModule { ccall(name: string, returnType: string): string }

let enginePromise: Promise<AnnliteModule> | null = null

async function loadEngine(): Promise<AnnliteModule> {
  if (enginePromise) return enginePromise
  enginePromise = (async () => {
    const root = import.meta.env.BASE_URL
    const moduleUrl = `${root}wasm/annlite-engine.mjs`
    const [moduleResponse, wasmResponse] = await Promise.all([fetch(moduleUrl), fetch(`${root}wasm/annlite-engine.wasm`)])
    if (!moduleResponse.ok) throw new Error(`ANN WASM loader fetch failed: HTTP ${moduleResponse.status}`)
    if (!wasmResponse.ok) throw new Error(`ANN WASM binary fetch failed: HTTP ${wasmResponse.status}`)
    const [moduleSource, wasmBytes] = await Promise.all([moduleResponse.text(), wasmResponse.arrayBuffer()])
    const objectUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }))
    const imported = await import(/* @vite-ignore */ objectUrl) as { default: (options: Record<string, unknown>) => Promise<AnnliteModule> }
    URL.revokeObjectURL(objectUrl)
    return imported.default({
      instantiateWasm(imports: WebAssembly.Imports, success: (instance: WebAssembly.Instance) => void) {
        WebAssembly.instantiate(wasmBytes, imports).then(({ instance }) => success(instance))
        return {}
      },
    })
  })()
  return enginePromise
}

export async function runAnnlite(): Promise<RunResult> {
  const engine = await loadEngine()
  const observed = JSON.parse(engine.ccall('annlite_witness_run', 'string')) as AnnObservation
  const low = observed.frontier[0]
  const high = observed.frontier.at(-1)!
  return {
    passed: observed.passed,
    summary: observed.passed
      ? 'Increasing efSearch recovered the missed neighbors while exposing the extra distance work.'
      : 'The measured recall/work frontier did not satisfy its monotonic recovery oracle.',
    metrics: [
      { label: `RECALL @ EF=${low.ef}`, value: `${(low.recall * 100).toFixed(3)}%`, tone: 'warn' },
      { label: `RECALL @ EF=${high.ef}`, value: `${(high.recall * 100).toFixed(3)}%`, tone: observed.passed ? 'good' : 'warn' },
      { label: 'DISTANCE WORK', value: `${low.meanComputations.toFixed(1)} → ${high.meanComputations.toFixed(1)}`, tone: 'neutral' },
      { label: 'FRONTIER', value: observed.recallMonotone && observed.workMonotone ? 'MONOTONE' : 'BROKEN', tone: observed.passed ? 'good' : 'warn' },
    ],
    trace: [
      `Built the pinned HNSW C++ engine with ${observed.vectors} vectors × ${observed.dimensions} dimensions.`,
      `Computed exact top-${observed.k} ground truth for ${observed.queries} deterministic queries.`,
      ...observed.frontier.map((point) => `efSearch=${point.ef}: recall=${(point.recall * 100).toFixed(3)}%, mean distance computations=${point.meanComputations.toFixed(2)}.`),
      `Recall monotone=${observed.recallMonotone}; work monotone=${observed.workMonotone}; recovery oracle=${observed.passed}.`,
    ],
    raw: observed as unknown as Record<string, unknown>,
  }
}
