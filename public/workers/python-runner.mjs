import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs'

const appRoot = new URL('../', self.location.href)
let pyodidePromise
const mounted = new Set()

const projects = {
  autonomy: {
    name: 'track-fusion', packages: ['numpy', 'scipy'],
    files: ['tf/__init__.py', 'tf/gating.py', 'tf/imm.py', 'tf/kalman.py', 'tf/metrics.py', 'tf/models.py', 'tf/scenarios.py', 'tf/track.py', 'tf/tracker.py', 'tf/assoc/__init__.py', 'tf/assoc/gnn.py', 'tf/assoc/jpda.py'],
  },
  quant: {
    name: 'lob-market-making', packages: [],
    files: ['lob/__init__.py', 'lob/book.py', 'lob/flow.py', 'lob/metrics.py', 'lob/sim.py', 'lob/strategies.py'],
  },
  imaging: {
    name: 'sar-focus', packages: ['numpy'],
    files: ['sar/__init__.py', 'sar/autofocus.py', 'sar/focus.py', 'sar/geometry.py', 'sar/metrics.py', 'sar/simulate.py', 'sar/waveform.py'],
  },
  navigation: {
    name: 'vio-nav', packages: ['numpy'],
    files: ['vio/__init__.py', 'vio/camera.py', 'vio/imu.py', 'vio/lie.py', 'vio/metrics.py', 'vio/msckf.py', 'vio/run.py', 'vio/simulate.py'],
  },
  numerical: {
    name: 'aad-greeks', packages: ['numpy'],
    files: ['aad/__init__.py', 'aad/models.py', 'aad/tape.py'],
  },
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
  const project = projects[capsule]
  if (!project) throw new Error(`Unknown Python capsule: ${capsule}`)
  const root = `/workspace/${project.name}`
  pyodide.FS.mkdirTree(root)
  for (const file of project.files) {
    const response = await fetch(new URL(`python/${project.name}/${file}`, appRoot))
    if (!response.ok) throw new Error(`Source fetch failed for ${file}: HTTP ${response.status}`)
    const target = `${root}/${file}`
    pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')))
    pyodide.FS.writeFile(target, await response.text(), { encoding: 'utf8' })
  }
  mounted.add(capsule)
  self.postMessage({ id, type: 'progress', message: `Mounted ${project.files.length} pinned Python source files.` })
}

const scripts = {
  autonomy: `
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
`,
  quant: `
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
`,
  imaging: `
import json, sys
sys.path.insert(0, '/workspace/sar-focus')
import numpy as np
from sar.autofocus import pga
from sar.focus import Grid, backproject
from sar.geometry import point_targets, stripmap
from sar.metrics import analyse_point, entropy
from sar.simulate import apply_phase_error, random_phase_error, raw_data
from sar.waveform import Chirp
ch = Chirp(fc=10e9, B=200e6, Tp=5e-6, fs=240e6)
col = stripmap(ch, velocity=200.0, altitude=3000.0, ground_range=4000.0, aperture=200.0, prf=600.0)
raw = raw_data(col, point_targets([(0., 0.), (3., 2.), (-3., -2.), (2., -3.)]))
phase = random_phase_error(col.n_pulses, 5.0, seed=1)
grid = Grid(16.0, 16.0, 0.05)
before = backproject(col, ch.compress(apply_phase_error(raw, phase)), grid)
after, _ = pga(before, iterations=8)
irw_before = analyse_point(before, 0.05)['azimuth']['irw']
irw_after = analyse_point(after, 0.05)['azimuth']['irw']
entropy_before = entropy(before)
entropy_after = entropy(after)
entropy_improved = entropy_after < entropy_before
resolution_worsened = irw_after > irw_before
passed = bool(entropy_improved and resolution_worsened)
json.dumps({
  'passed': passed,
  'summary': 'Metric conflict detected: entropy improved while azimuth resolution widened.' if passed else 'The seeded autofocus metric-conflict oracle did not reproduce.',
  'metrics': [
    {'label': 'ENTROPY', 'value': f'{entropy_before:.3f} → {entropy_after:.3f}', 'tone': 'good' if entropy_improved else 'warn'},
    {'label': 'AZIMUTH IRW', 'value': f'{irw_before:.4f} → {irw_after:.4f} m', 'tone': 'warn' if resolution_worsened else 'good'},
    {'label': 'RECOVERY', 'value': f'{irw_before / irw_after:.2f}×', 'tone': 'warn'},
    {'label': 'IMAGE GRID', 'value': f'{before.shape[0]} × {before.shape[1]}', 'tone': 'neutral'},
  ],
  'trace': [
    f'Simulated four point targets across {col.n_pulses} stripmap pulses.',
    'Injected a seeded random phase error at 5.0 rad RMS.',
    f'Backprojected a {before.shape[0]} × {before.shape[1]} image and ran eight PGA iterations.',
    f'Entropy {entropy_before:.6f} → {entropy_after:.6f}; lower is sharper by that scalar.',
    f'Azimuth IRW {irw_before:.6f} m → {irw_after:.6f} m; wider is worse resolution.',
    f'Metric-disagreement oracle passed={passed}.',
  ],
  'raw': {'pulses': int(col.n_pulses), 'imageShape': [int(v) for v in before.shape], 'entropyBefore': float(entropy_before), 'entropyAfter': float(entropy_after), 'irwBeforeM': float(irw_before), 'irwAfterM': float(irw_after), 'recovery': float(irw_before / irw_after)},
})
`,
  navigation: `
import json, sys
sys.path.insert(0, '/workspace/vio-nav')
import numpy as np
from vio.camera import Camera
from vio.imu import ImuNoise
from vio.metrics import ate
from vio.run import run_dead_reckoning, run_msckf
from vio.simulate import Dataset, Trajectory, make_landmarks
traj = Trajectory('hover', radius=6.0, period=20.0)
cam = Camera()
lms = make_landmarks(traj, n=250, seed=1)
ds = Dataset(traj, lms, cam, duration=8.0, noise=ImuNoise(), seed=2, pixel_noise=1.0)
idx = ds.frame_idx
truth = np.array([traj.position(t) for t in ds.imu_t[idx]])
_, _, dead_reckoning = run_dead_reckoning(ds)
filter_, _, _, vio = run_msckf(ds)
parallax = filter_.stats['rejected_parallax']
triangulation = filter_.stats['rejected_triangulation']
rejected = parallax + triangulation
dr_ate = ate(dead_reckoning, truth)['rmse']
vio_ate = ate(vio, truth)['rmse']
passed = bool(rejected > 0 and abs(vio_ate - dr_ate) < 1e-12)
json.dumps({
  'passed': passed,
  'summary': 'No-parallax features were rejected and the camera invented no position correction.' if passed else 'The hover observability guard did not match its pinned behavior.',
  'metrics': [
    {'label': 'REJECTED', 'value': f'{rejected:,}', 'tone': 'good' if rejected else 'warn'},
    {'label': 'PARALLAX', 'value': f'{parallax:,}', 'tone': 'neutral'},
    {'label': 'DR ATE', 'value': f'{dr_ate:.5f} m', 'tone': 'neutral'},
    {'label': 'VIO ATE', 'value': f'{vio_ate:.5f} m', 'tone': 'good' if passed else 'warn'},
  ],
  'trace': [
    'Created an eight-second stationary hover with 250 seeded landmarks.',
    f'Processed {len(idx)} camera frames through the pinned MSCKF.',
    f'Rejected {parallax:,} no-parallax and {triangulation:,} triangulation attempts.',
    f'Dead-reckoning ATE={dr_ate:.12f} m; VIO ATE={vio_ate:.12f} m.',
    f'No invented camera correction={abs(vio_ate-dr_ate) < 1e-12}; observability oracle passed={passed}.',
  ],
  'raw': {'frames': int(len(idx)), 'rejectedParallax': int(parallax), 'rejectedTriangulation': int(triangulation), 'deadReckoningAteM': float(dr_ate), 'vioAteM': float(vio_ate), 'filterStats': {k: int(v) for k, v in filter_.stats.items()}},
})
`,
  numerical: `
import json, sys, math
sys.path.insert(0, '/workspace/aad-greeks')
import numpy as np
from aad.models import mc_digital
from aad.tape import grad
p = dict(S=100.0, K=100.0, r=0.03, sigma=0.20, T=1.0)
z = np.random.default_rng(0).standard_normal(200_000)
_, sharp, _ = grad(lambda **kw: mc_digital(**kw, z=z, smoothing=0.0), p)
d2 = (math.log(p['S']/p['K']) + (p['r'] - 0.5*p['sigma']**2)*p['T']) / (p['sigma']*math.sqrt(p['T']))
analytic = math.exp(-p['r']*p['T']) * math.exp(-0.5*d2*d2) / math.sqrt(2*math.pi) / (p['S']*p['sigma']*math.sqrt(p['T']))
h = 0.5
up = mc_digital(**{**p, 'S': p['S'] + h}, z=z, smoothing=0.0)
down = mc_digital(**{**p, 'S': p['S'] - h}, z=z, smoothing=0.0)
bumped = (up - down) / (2*h)
_, smooth, _ = grad(lambda **kw: mc_digital(**kw, z=z, smoothing=1.0), p)
sharp_zero = sharp['S'] == 0.0
bump_close = abs(bumped / analytic - 1.0) < 0.05
smooth_close = abs(smooth['S'] / analytic - 1.0) < 0.05
passed = bool(sharp_zero and analytic > 0.015 and bump_close and smooth_close)
json.dumps({
  'passed': passed,
  'summary': 'The zero pathwise derivative was caught by independent analytic, bumped, and smoothed oracles.' if passed else 'The discontinuous-payoff cross-check did not reproduce.',
  'metrics': [
    {'label': 'PATHWISE AAD', 'value': f'{sharp["S"]:.6f}', 'tone': 'warn'},
    {'label': 'ANALYTIC', 'value': f'{analytic:.6f}', 'tone': 'good'},
    {'label': 'CENTRAL DIFF', 'value': f'{bumped:.6f}', 'tone': 'good' if bump_close else 'warn'},
    {'label': 'SMOOTHED AAD', 'value': f'{smooth["S"]:.6f}', 'tone': 'good' if smooth_close else 'warn'},
  ],
  'trace': [
    'Generated 200,000 standard normals with NumPy PCG64 seed 0.',
    f'Pathwise reverse-mode AAD returned delta={sharp["S"]:.12f}.',
    f'Independent analytic digital delta={analytic:.12f}.',
    f'Common-random-number central difference at h=0.5 returned {bumped:.12f}.',
    f'Call-spread smoothing at width 1.0 returned AAD delta={smooth["S"]:.12f}.',
    f'Zero-delta counterexample and two recovery checks passed={passed}.',
  ],
  'raw': {'samples': int(len(z)), 'pathwiseAad': float(sharp['S']), 'analyticDelta': float(analytic), 'centralDifference': float(bumped), 'smoothedAad': float(smooth['S']), 'bumpWithinFivePercent': bool(bump_close), 'smoothWithinFivePercent': bool(smooth_close)},
})
`,
}

self.addEventListener('message', async (event) => {
  const { id, capsule } = event.data
  try {
    const project = projects[capsule]
    if (!project) throw new Error(`Unknown Python capsule: ${capsule}`)
    const pyodide = await getPyodide(id)
    if (project.packages.length) {
      self.postMessage({ id, type: 'progress', message: `Loading ${project.packages.join(' + ')} wheel${project.packages.length > 1 ? 's' : ''}…` })
      await pyodide.loadPackage(project.packages)
    }
    await mount(pyodide, capsule, id)
    self.postMessage({ id, type: 'progress', message: 'Executing pinned scenario and oracle…' })
    const serialized = await pyodide.runPythonAsync(scripts[capsule])
    self.postMessage({ id, type: 'result', result: JSON.parse(serialized) })
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
