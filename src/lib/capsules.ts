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
  {
    id: 'search', index: '05', caseNumber: 'CX-010', receipt: 'receipts/ann-low-budget-recall.receipt.json', receiptId: 'ann-low-budget-recall',
    label: 'VECTOR SEARCH', system: 'ANNLite HNSW', title: 'Fast search must disclose what it leaves behind', runtime: 'C++17 → WASM',
    runtimeDetail: 'The pinned HNSW implementation builds and searches its graph locally in WebAssembly.', repository: 'asp53826/annlite', commit: 'dc922c8c1816df48d75f2a16e51cd25819aab070',
    invariant: 'A latency claim must remain paired with exact-ground-truth recall across the search-work frontier.',
    instruction: 'Build one deterministic HNSW graph, hold its queries fixed, then sweep efSearch against exact top-10 neighbors.',
    sourceUrl: 'https://github.com/asp53826/annlite/tree/dc922c8c1816df48d75f2a16e51cd25819aab070',
    testUrl: 'https://github.com/asp53826/annlite/blob/dc922c8c1816df48d75f2a16e51cd25819aab070/tests/test_index.py#L77-L112',
    expectedReceiptSha256: 'cffc4aa733f3c13b314b666c99304a9fea583558322ed829e6aa83a7f118bf4a',
  },
  {
    id: 'imaging', index: '06', caseNumber: 'CX-011', receipt: 'receipts/sar-high-order-phase.receipt.json', receiptId: 'sar-high-order-phase',
    label: 'SAR IMAGING', system: 'PGA Autofocus', title: 'A sharper score can hide worse resolution', runtime: 'Python / NumPy → Pyodide Worker',
    runtimeDetail: 'Pinned SAR simulation, backprojection, autofocus, and metrics execute off the UI thread.', repository: 'asp53826/sar-focus', commit: '83041573ebcfa935640f91cb091e1dbaad4f9aaa',
    invariant: 'Autofocus acceptance must report both image entropy and impulse-response width; one scalar cannot stand in for image quality.',
    instruction: 'Inject a seeded 5 rad RMS phase error, run eight PGA iterations, and compare entropy with azimuth IRW.',
    sourceUrl: 'https://github.com/asp53826/sar-focus/tree/83041573ebcfa935640f91cb091e1dbaad4f9aaa',
    testUrl: 'https://github.com/asp53826/sar-focus/blob/83041573ebcfa935640f91cb091e1dbaad4f9aaa/tests/test_imaging.py#L182-L188',
    expectedReceiptSha256: '0025d98e9f631c2f487bf3214364a9af6b5987817449e11671fda46404dd9b9e',
  },
  {
    id: 'navigation', index: '07', caseNumber: 'CX-006', receipt: 'receipts/vio-hover-no-parallax.receipt.json', receiptId: 'vio-hover-no-parallax',
    label: 'NAVIGATION', system: 'MSCKF VIO', title: 'No baseline means no observable depth', runtime: 'Python / NumPy → Pyodide Worker',
    runtimeDetail: 'Pinned simulator and MSCKF execute in an isolated Python worker.', repository: 'asp53826/vio-nav', commit: 'f38714f391ffb0dc3ae06b418aae51f929000e1e',
    invariant: 'A stationary camera must reject feature depth updates that contain no translational parallax.',
    instruction: 'Hold the camera in a deterministic eight-second hover and count every parallax/triangulation rejection.',
    sourceUrl: 'https://github.com/asp53826/vio-nav/tree/f38714f391ffb0dc3ae06b418aae51f929000e1e',
    testUrl: 'https://github.com/asp53826/vio-nav/blob/f38714f391ffb0dc3ae06b418aae51f929000e1e/tests/test_filter.py#L166-L175',
    expectedReceiptSha256: 'be84bcd3f1737f84f292a0169384b6701f537613a847621b19bf55d887a9f37e',
  },
  {
    id: 'numerical', index: '08', caseNumber: 'CX-007', receipt: 'receipts/aad-digital-zero.receipt.json', receiptId: 'aad-digital-zero',
    label: 'NUMERICAL', system: 'AAD Greeks', title: 'A derivative can be exact and still be wrong', runtime: 'Python / NumPy → Pyodide Worker',
    runtimeDetail: 'Pinned reverse-mode tape and Monte Carlo model execute off the UI thread.', repository: 'asp53826/aad-greeks', commit: 'c26ef7aa18f473b7cfd85642a62aef3a17b94c58',
    invariant: 'A discontinuous payoff cannot rely on pathwise AAD alone; an independent analytic or bumped oracle must remain visible.',
    instruction: 'Differentiate one 200,000-path digital payoff three ways using the same seeded normal draws.',
    sourceUrl: 'https://github.com/asp53826/aad-greeks/tree/c26ef7aa18f473b7cfd85642a62aef3a17b94c58',
    testUrl: 'https://github.com/asp53826/aad-greeks/blob/c26ef7aa18f473b7cfd85642a62aef3a17b94c58/tests/test_greeks.py#L169-L205',
    expectedReceiptSha256: 'd2d00e9583dfd3f7e7674985b8955cda352818e4a068299749e95cb97e75e4a3',
  },
]

export const capsuleById = Object.fromEntries(capsules.map((capsule) => [capsule.id, capsule])) as Record<CapsuleId, CapsuleDefinition>

export function capsuleFromLocation(): CapsuleId {
  const requested = new URLSearchParams(window.location.search).get('capsule')
  return capsules.some((capsule) => capsule.id === requested) ? requested as CapsuleId : 'systems'
}
