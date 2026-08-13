import type { CapsuleDefinition, CapsuleId } from '../types'

export const capsules: CapsuleDefinition[] = [
  {
    id: 'systems', index: '01', caseNumber: 'CX-001', receipt: 'receipts/raft-minority-noncommit.receipt.json', receiptId: 'raft-minority-noncommit',
    label: 'SYSTEMS', system: 'Raft + MVCC', title: 'Minority writes do not commit', runtime: 'C++17 → WASM',
    runtimeDetail: 'Compiled Raft engine executes locally in this tab.', repository: 'asp53826/raft-mvcc', commit: 'a5dd0986756b26ff5f375b73d03d618d9b2aded0',
    invariant: 'A locally appended command cannot become committed or visible without majority acknowledgement.',
    instruction: 'Elect node 1, isolate it, propose transaction 7, then compare its log and commit index.',
    sourceUrl: 'https://github.com/asp53826/raft-mvcc/tree/a5dd0986756b26ff5f375b73d03d618d9b2aded0',
    testUrl: 'https://github.com/asp53826/raft-mvcc/blob/a5dd0986756b26ff5f375b73d03d618d9b2aded0/tests/test_raft_mvcc.cpp#L191-L210',
    expectedReceiptSha256: '57c9cc96b82129672391606b85b45a8b3cdd9f32588a3df22bb841fd78890313',
  },
  {
    id: 'ml', index: '02', caseNumber: 'CX-009', receipt: 'receipts/tensor-shape-mismatch.receipt.json', receiptId: 'tensor-shape-mismatch',
    label: 'ML COMPILER', system: 'TensorForge', title: 'Invalid tensor shapes stop at the front door', runtime: 'TypeScript',
    runtimeDetail: 'The original compiler validator runs in the main browser runtime.', repository: 'asp53826/tensorforge-webgpu', commit: '70a5c855ef35e01a29ba351eb2645670060b9f0b',
    invariant: 'Every matrix multiply must have equal contracting dimensions before optimization or GPU dispatch.',
    instruction: 'Mutate W₁ from [128, 256] to [127, 256] and require a precise pre-dispatch rejection.',
    sourceUrl: 'https://github.com/asp53826/tensorforge-webgpu/tree/70a5c855ef35e01a29ba351eb2645670060b9f0b',
    testUrl: 'https://github.com/asp53826/tensorforge-webgpu/blob/70a5c855ef35e01a29ba351eb2645670060b9f0b/src/test/compiler.test.ts#L40-L45',
    expectedReceiptSha256: '37576d77588845f3023d2debcb397f53eacfb91cdca94250f1013c1f778eefa6',
  },
  {
    id: 'autonomy', index: '03', caseNumber: 'CX-005', receipt: 'receipts/clutter-confirms-ghosts.receipt.json', receiptId: 'clutter-confirms-ghosts',
    label: 'AUTONOMY', system: 'Track Fusion', title: 'Pure clutter cannot become a target', runtime: 'Python → Pyodide Worker',
    runtimeDetail: 'Pinned Python tracker, NumPy, and SciPy execute off the UI thread.', repository: 'asp53826/track-fusion', commit: '9a1092b8da88f5904ca190a393d77bd2bcd111b8',
    invariant: 'Confirmation evidence must distinguish a concentrated target likelihood from a large gate containing clutter.',
    instruction: 'Replay 40 seeded scans with zero targets and six expected false alarms per scan.',
    sourceUrl: 'https://github.com/asp53826/track-fusion/tree/9a1092b8da88f5904ca190a393d77bd2bcd111b8',
    testUrl: 'https://github.com/asp53826/track-fusion/blob/9a1092b8da88f5904ca190a393d77bd2bcd111b8/tests/test_tracker.py',
    expectedReceiptSha256: '762231d01fdd53b48b8b958f22cc06b03476b5f3997246a6aa84168eaf29038d',
  },
  {
    id: 'quant', index: '04', caseNumber: 'CX-008', receipt: 'receipts/lob-profit-hides-risk.receipt.json', receiptId: 'lob-profit-hides-risk',
    label: 'QUANT', system: 'Market Microstructure', title: 'Profit must report carried inventory risk', runtime: 'Python → Pyodide Worker',
    runtimeDetail: 'Pinned exchange simulation executes in an isolated worker.', repository: 'asp53826/lob-market-making', commit: '82c75a1fd7824dd96bdb92432b58b3557cb7d577',
    invariant: 'Every profitability claim keeps inventory exposure and exact P&L decomposition beside the total.',
    instruction: 'Run paired 4,000-step simulations at seed 3 and compare naive versus inventory-skew quoting.',
    sourceUrl: 'https://github.com/asp53826/lob-market-making/tree/82c75a1fd7824dd96bdb92432b58b3557cb7d577',
    testUrl: 'https://github.com/asp53826/lob-market-making/blob/82c75a1fd7824dd96bdb92432b58b3557cb7d577/tests/test_sim.py#L92-L96',
    expectedReceiptSha256: 'fa02f77611c71febb1d064c94e534db375104fd8998a39e5aee6d78d0d6e0cba',
  },
]

export const capsuleById = Object.fromEntries(capsules.map((capsule) => [capsule.id, capsule])) as Record<CapsuleId, CapsuleDefinition>

export function capsuleFromLocation(): CapsuleId {
  const requested = new URLSearchParams(window.location.search).get('capsule')
  return capsules.some((capsule) => capsule.id === requested) ? requested as CapsuleId : 'systems'
}
