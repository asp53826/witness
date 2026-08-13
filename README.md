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

The Python worker accepts only these four hard-coded scenarios. It does not evaluate visitor-supplied code. Exact source and artifact hashes are recorded in [`public/source-manifest.json`](public/source-manifest.json).

## Integrity boundary

Before a capsule runs, WITNESS recomputes the canonical receipt SHA-256, recomputes the embedded capsule SHA-256, and checks the receipt subject commit against the capsule commit. A mismatch blocks execution.

The downloaded `witness-local-run/v1` file is a deterministic record of one browser run. It is explicitly marked `local-unattested`; it is not a replacement for the signed COUNTEREXAMPLE release provenance.

## Local verification

```bash
npm ci
npm run check
npm run dev
```

The check suite validates all four receipt digests, the TensorForge oracle, the actual WebAssembly Raft scenario, lint, TypeScript, and the production build.

## Honest scope

- These are focused deterministic counterexamples, not full benchmark suites.
- The autonomy run uses a simulation likelihood model, not calibrated production sensor data.
- The quant run is a paired 4,000-step targeted test, not the published twelve-seed 20,000-step benchmark.
- Pyodide cold-starts may take several seconds because scientific Python wheels are loaded in a Worker.

## License

MIT. See [LICENSE](LICENSE).
