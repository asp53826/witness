# WITNESS

WITNESS is a live reproducibility chamber for engineering claims. It verifies a canonical [COUNTEREXAMPLE](https://github.com/asp53826/counterexample) receipt, executes the receipt-bound implementation in the browser, compares the observed trace with a deterministic oracle, and emits a downloadable local run receipt.

**Live lab:** [asp53826.github.io/witness](https://asp53826.github.io/witness/)

## Executable capsules

| Capsule | Runtime in the browser | Pinned subject | Oracle |
|---|---|---|---|
| Systems | C++17 compiled to WebAssembly | `raft-mvcc@a5dd098` | isolated leader appends locally but cannot commit or expose a value |
| ML compiler | TypeScript | `tensorforge-webgpu@70a5c85` | incompatible matrix dimensions are rejected before GPU dispatch |
| Autonomy | Python, NumPy, and SciPy in a Pyodide Worker | `track-fusion@9a1092b` | target-free clutter produces at most four confirmations |
| Quant | Python in a Pyodide Worker | `lob-market-making@82c75a1` | inventory skew reduces inventory dispersion and both P&L ledgers reconcile |
| Vector search | C++17 compiled to WebAssembly | `annlite@dc922c8` | increasing `efSearch` recovers exact-ground-truth neighbors at measurable work cost |
| SAR imaging | Python and NumPy in a Pyodide Worker | `sar-focus@8304157` | entropy improves while azimuth impulse-response width gets worse |
| Navigation | Python and NumPy in a Pyodide Worker | `vio-nav@f38714f` | stationary-camera features are rejected for missing parallax |
| Numerical finance | Python and NumPy in a Pyodide Worker | `aad-greeks@c26ef7a` | analytic, bumped, and smoothed deltas expose pathwise AAD's false zero |

The Python worker accepts only the five hard-coded Python scenarios listed above. It does not evaluate visitor-supplied code. Exact source and artifact hashes are recorded in [`public/source-manifest.json`](public/source-manifest.json).

## Integrity boundary

Before a capsule runs, WITNESS recomputes the canonical receipt SHA-256, recomputes the embedded capsule SHA-256, and checks the receipt subject commit against the capsule commit. A mismatch blocks execution.

The downloaded `witness-local-run/v1` file is a deterministic record of one browser run. It is explicitly marked `local-unattested`; it is not a replacement for the signed COUNTEREXAMPLE release provenance.

## Local verification

```bash
npm ci
npm run check
npm run dev
```

The check suite validates all eight receipt digests, the TensorForge oracle, both C++ WebAssembly scenarios, lint, TypeScript, and the production build.

## Honest scope

- These are focused deterministic counterexamples, not full benchmark suites.
- The autonomy run uses a simulation likelihood model, not calibrated production sensor data.
- The quant run is a paired 4,000-step targeted test, not the published twelve-seed 20,000-step benchmark.
- The ANN run is a deterministic targeted graph/query set, not the repository's published SIFT1M throughput benchmark.
- The SAR run is a simulated stripmap point-target scene. It reproduces the pinned metric conflict, not flight-data image quality.
- The VIO run is the pinned eight-second synthetic hover test. It demonstrates an observability guard, not field navigation accuracy.
- The AAD run is a seeded 200,000-path digital-payoff test. It is not a production pricing or risk recommendation.
- Pyodide cold-starts may take several seconds because scientific Python wheels are loaded in a Worker.

## License

MIT. See [LICENSE](LICENSE).
