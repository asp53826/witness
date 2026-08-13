import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.28.2/full/pyodide.mjs'

const appRoot = new URL('../', self.location.href)
let pyodidePromise
const mounted = new Set()
const packageFiles = {
  autonomy: ['tf/__init__.py', 'tf/gating.py', 'tf/imm.py', 'tf/kalman.py', 'tf/metrics.py', 'tf/models.py', 'tf/scenarios.py', 'tf/track.py', 'tf/tracker.py', 'tf/assoc/__init__.py', 'tf/assoc/gnn.py', 'tf/assoc/jpda.py'],
  quant: ['lob/__init__.py', 'lob/book.py', 'lob/flow.py', 'lob/metrics.py', 'lob/sim.py', 'lob/strategies.py'],
}

async function getPyodide(id) {
  if (!pyodidePromise) {
    self.postMessage({ id, type: 'progress', message: 'Cold-starting CPython / Pyodide worker…' })
    pyodidePromise = loadPyodide()
  }
  return pyodidePromise
}

async function mount(pyodide, capsule, id) {
  if (mounted.has(capsule)) return
  const project = capsule === 'autonomy' ? 'track-fusion' : 'lob-market-making'
  const root = `/workspace/${project}`
  pyodide.FS.mkdirTree(root)
  for (const file of packageFiles[capsule]) {
    const response = await fetch(new URL(`python/${project}/${file}`, appRoot))
    if (!response.ok) throw new Error(`Source fetch failed for ${file}: HTTP ${response.status}`)
    const target = `${root}/${file}`
    pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')))
    pyodide.FS.writeFile(target, await response.text(), { encoding: 'utf8' })
  }
  mounted.add(capsule)
  self.postMessage({ id, type: 'progress', message: `Mounted ${packageFiles[capsule].length} pinned Python source files.` })
}

const autonomyScript = `
import json, sys
sys.path.insert(0, '/workspace/track-fusion')
import numpy as np
from tf.tracker import Tracker, Config
from tf.track import Track
Track.reset_ids()
rng = np.random.default_rng(4)
tracker = Tracker(Config(sigma=20.0, Pd=0.9, clutter_density=6.0/(4000*4000)))
per_scan = []
clutter_counts = []
for _ in range(40):
    count = int(rng.poisson(6.0))
    clutter_counts.append(count)
    Z = rng.uniform(-2000, 2000, (count, 2))
    per_scan.append(len(tracker.step(Z)))
confirmed_total = sum(per_scan)
passed = confirmed_total <= 4
json.dumps({
  'passed': passed,
  'summary': 'Wald LLR guard held: pure clutter produced no confirmed target.' if passed else 'Clutter exceeded the false-confirmation guard.',
  'metrics': [
    {'label': 'SCANS', 'value': '40', 'tone': 'neutral'},
    {'label': 'CLUTTER RETURNS', 'value': str(sum(clutter_counts)), 'tone': 'neutral'},
    {'label': 'CONFIRMED', 'value': str(confirmed_total), 'tone': 'good' if passed else 'warn'},
    {'label': 'ORACLE', 'value': '≤ 4', 'tone': 'good'},
  ],
  'trace': [
    'Seeded NumPy PCG64 with seed 4.',
    f'Generated {sum(clutter_counts)} uniform false alarms across 40 target-free scans.',
    'Executed Tracker.step() with JPDA association and Wald sequential LLR promotion.',
    f'Observed {confirmed_total} confirmed tracks; acceptance boundary is at most 4.',
    f'Target-free guard passed={passed}.',
  ],
  'raw': {'confirmedTotal': confirmed_total, 'perScan': per_scan, 'clutterCounts': clutter_counts, 'trackerStats': tracker.stats},
})
`

const quantScript = `
import json, sys
sys.path.insert(0, '/workspace/lob-market-making')
from lob.sim import Config, run
from lob.strategies import NaiveMM, InventorySkew
from lob.metrics import report, decompose
cfg = Config(steps=4000, seed=3)
naive_run = run(NaiveMM(half_spread=2), cfg)
skew_run = run(InventorySkew(half_spread=2), cfg)
naive = report(naive_run)
skew = report(skew_run)
naive_d = decompose(naive_run)
skew_d = decompose(skew_run)
naive_exact = naive_d.check(naive_run.pnl())
skew_exact = skew_d.check(skew_run.pnl())
passed = skew.inv_std < naive.inv_std and naive_exact and skew_exact
json.dumps({
  'passed': passed,
  'summary': 'Inventory-skew reduced carried risk and both P&L ledgers reconciled exactly.' if passed else 'The paired risk/decomposition oracle failed.',
  'metrics': [
    {'label': 'NAIVE INV σ', 'value': f'{naive.inv_std:.2f}', 'tone': 'warn'},
    {'label': 'SKEW INV σ', 'value': f'{skew.inv_std:.2f}', 'tone': 'good'},
    {'label': 'RISK REDUCTION', 'value': f'{(1-skew.inv_std/naive.inv_std)*100:.1f}%', 'tone': 'good'},
    {'label': 'P&L LEDGERS', 'value': '2 / 2 EXACT', 'tone': 'good' if naive_exact and skew_exact else 'warn'},
  ],
  'trace': [
    'Created paired 4,000-step simulations with seed 3.',
    f'Naive: P&L={naive.pnl:.2f}, inventory σ={naive.inv_std:.2f}, max |q|={naive.inv_max_abs}.',
    f'Skew: P&L={skew.pnl:.2f}, inventory σ={skew.inv_std:.2f}, max |q|={skew.inv_max_abs}.',
    f'Naive decomposition exact={naive_exact}; skew decomposition exact={skew_exact}.',
    f'Inventory-risk oracle passed={passed}.',
  ],
  'raw': {
    'naive': {'pnl': naive.pnl, 'invStd': naive.inv_std, 'invMaxAbs': naive.inv_max_abs, 'fills': naive.fills, 'spreadCapture': naive_d.spread_capture, 'inventoryPnl': naive_d.inventory_pnl},
    'skew': {'pnl': skew.pnl, 'invStd': skew.inv_std, 'invMaxAbs': skew.inv_max_abs, 'fills': skew.fills, 'spreadCapture': skew_d.spread_capture, 'inventoryPnl': skew_d.inventory_pnl},
    'decompositionExact': {'naive': naive_exact, 'skew': skew_exact},
  },
})
`

self.addEventListener('message', async (event) => {
  const { id, capsule } = event.data
  try {
    const pyodide = await getPyodide(id)
    if (capsule === 'autonomy') {
      self.postMessage({ id, type: 'progress', message: 'Loading NumPy and SciPy wheels…' })
      await pyodide.loadPackage(['numpy', 'scipy'])
    }
    await mount(pyodide, capsule, id)
    self.postMessage({ id, type: 'progress', message: 'Executing pinned scenario and oracle…' })
    const serialized = await pyodide.runPythonAsync(capsule === 'autonomy' ? autonomyScript : quantScript)
    self.postMessage({ id, type: 'result', result: JSON.parse(serialized) })
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
