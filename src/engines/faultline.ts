import type { RunResult } from '../types'

interface FaultlineNode { id: number; role: string; term: number; commit: number; lastIndex: number; leader: number | null; digest: string }
interface FaultlineSnapshot { engine: string; tick: number; dropped: number; isolated: number; event: string; nodes: FaultlineNode[] }
interface FaultlineModule { ccall(name: string, returnType: string, argumentTypes?: string[], argumentsList?: unknown[]): string }

let enginePromise: Promise<FaultlineModule> | null = null

async function loadEngine(): Promise<FaultlineModule> {
  if (enginePromise) return enginePromise
  enginePromise = (async () => {
    const root = import.meta.env.BASE_URL
    const moduleUrl = `${root}wasm/faultline-engine.mjs`
    const [moduleResponse, wasmResponse] = await Promise.all([fetch(moduleUrl), fetch(`${root}wasm/faultline-engine.wasm`)])
    if (!moduleResponse.ok) throw new Error(`WASM loader fetch failed: HTTP ${moduleResponse.status}`)
    if (!wasmResponse.ok) throw new Error(`WASM binary fetch failed: HTTP ${wasmResponse.status}`)
    const [moduleSource, wasmBytes] = await Promise.all([moduleResponse.text(), wasmResponse.arrayBuffer()])
    const objectUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }))
    const imported = await import(/* @vite-ignore */ objectUrl) as { default: (options: Record<string, unknown>) => Promise<FaultlineModule> }
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

function call(engine: FaultlineModule, name: string, types: string[] = [], args: unknown[] = []): FaultlineSnapshot {
  return JSON.parse(engine.ccall(name, 'string', types, args)) as FaultlineSnapshot
}

export async function runFaultline(): Promise<RunResult> {
  const engine = await loadEngine()
  call(engine, 'faultline_reset')
  const elected = call(engine, 'faultline_campaign', ['number'], [1])
  const leaderBefore = elected.nodes.find((node) => node.id === 1)
  call(engine, 'faultline_isolate', ['number'], [1])
  const observed = call(engine, 'faultline_propose', ['number', 'string', 'string'], [7, 'account/alice', '90'])
  const isolatedLeader = observed.nodes.find((node) => node.id === 1)
  const followers = observed.nodes.filter((node) => node.id !== 1)
  const localAppend = isolatedLeader?.lastIndex === (leaderBefore?.lastIndex ?? 0) + 1
  const commitHeld = isolatedLeader?.commit === leaderBefore?.commit
  const followersUntouched = followers.every((node) => node.lastIndex === leaderBefore?.lastIndex)
  const stateInvisible = observed.nodes.every((node) => node.digest === '')
  const passed = Boolean(localAppend && commitHeld && followersUntouched && stateInvisible && observed.dropped === 4)
  return {
    passed,
    summary: passed ? 'Transaction 7 appended locally; commit index and state machine remained unchanged.' : 'The minority-commit guard did not match its expected state transition.',
    metrics: [
      { label: 'LOCAL LOG', value: `${leaderBefore?.lastIndex ?? 0} → ${isolatedLeader?.lastIndex ?? 0}`, tone: localAppend ? 'good' : 'warn' },
      { label: 'COMMIT INDEX', value: `${leaderBefore?.commit ?? 0} → ${isolatedLeader?.commit ?? 0}`, tone: commitHeld ? 'good' : 'warn' },
      { label: 'DROPPED MSGS', value: String(observed.dropped), tone: 'neutral' },
      { label: 'VISIBLE VALUE', value: stateInvisible ? 'NONE' : 'EXPOSED', tone: stateInvisible ? 'good' : 'warn' },
    ],
    trace: [elected.event, 'Bidirectional partition isolated node 1 from the four-node majority.', observed.event, `Node 1 commit=${isolatedLeader?.commit}; follower logs unchanged=${followersUntouched}.`, `MVCC digest empty on all five replicas=${stateInvisible}.`],
    raw: { elected, observed, assertions: { localAppend, commitHeld, followersUntouched, stateInvisible } },
  }
}
