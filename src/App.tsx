import { useMemo, useState } from 'react'
import './App.css'
import { runFaultline } from './engines/faultline'
import { runPythonCapsule } from './engines/pythonClient'
import { runTensorForge } from './engines/tensor'
import { capsuleById, capsuleFromLocation, capsules } from './lib/capsules'
import { canonical, sha256, verifyReceipt } from './lib/receipt'
import type { CapsuleId, LocalRunReceipt, ReceiptCheck, RunResult, RunStatus } from './types'

const ArrowIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
const RunIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>
const DownloadIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" /></svg>
const CopyIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3" /></svg>
const CheckIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
const LinkIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></svg>

const statusLabel: Record<RunStatus, string> = {
  idle: 'CHAMBER READY', verifying: 'VERIFYING RECEIPT', loading: 'LOADING RUNTIME', running: 'EXECUTING', passed: 'INVARIANT HELD', failed: 'ORACLE FAILED', error: 'EXECUTION ERROR',
}

function shortHash(value: string) { return `${value.slice(0, 8)}…${value.slice(-8)}` }

function App() {
  const [selected, setSelected] = useState<CapsuleId>(capsuleFromLocation)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [progress, setProgress] = useState('Select a capsule and execute its pinned counterexample.')
  const [receipt, setReceipt] = useState<ReceiptCheck | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [localReceipt, setLocalReceipt] = useState<LocalRunReceipt | null>(null)
  const [invertOracle, setInvertOracle] = useState(false)
  const [copied, setCopied] = useState(false)
  const capsule = capsuleById[selected]
  const busy = ['verifying', 'loading', 'running'].includes(status)

  const receiptRows = useMemo(() => [
    ['FORMAT', receipt?.format], ['RECEIPT SHA-256', receipt?.receiptDigest], ['CAPSULE SHA-256', receipt?.capsuleDigest], ['COMMIT BINDING', receipt?.commitBinding],
  ] as Array<[string, boolean | undefined]>, [receipt])

  function chooseCapsule(id: CapsuleId) {
    if (busy) return
    setSelected(id)
    setStatus('idle'); setProgress('Capsule mounted. Ready to verify receipt and execute.'); setReceipt(null); setResult(null); setLocalReceipt(null); setInvertOracle(false); setCopied(false)
    const url = new URL(window.location.href); url.searchParams.set('capsule', id); window.history.replaceState({}, '', url)
  }

  async function execute() {
    setResult(null); setLocalReceipt(null); setReceipt(null); setCopied(false)
    try {
      setStatus('verifying'); setProgress('Hashing canonical COUNTEREXAMPLE receipt and checking commit binding…')
      const checked = await verifyReceipt(`${import.meta.env.BASE_URL}${capsule.receipt}`, capsule.expectedReceiptSha256)
      setReceipt(checked)
      if (!checked.passed) throw new Error('Canonical receipt integrity check failed. Runtime execution was blocked.')
      setStatus('loading'); setProgress(`Loading ${capsule.runtime}…`)
      let observed: RunResult
      if (selected === 'systems') observed = await runFaultline()
      else if (selected === 'ml') observed = await runTensorForge()
      else observed = await runPythonCapsule(selected, (message) => { setStatus(message.includes('Executing') ? 'running' : 'loading'); setProgress(message) })
      const effective = invertOracle ? { ...observed, passed: !observed.passed, summary: 'Engine output is unchanged, but the inverted oracle makes the proof comparison fail.' } : observed
      const unsigned = {
        format: 'witness-local-run/v1' as const, capsule: selected, subjectCommit: capsule.commit, runtime: capsule.runtime,
        canonicalReceiptSha256: checked.observedReceiptSha256, canonicalReceiptVerified: checked.passed, oracleInverted: invertOracle,
        result: effective, timestamp: new Date().toISOString(), signatureStatus: 'local-unattested' as const,
      }
      const traceSha256 = await sha256(canonical(unsigned))
      setResult(effective); setLocalReceipt({ ...unsigned, traceSha256 }); setStatus(effective.passed ? 'passed' : 'failed')
      setProgress(effective.passed ? 'Execution complete. The measured trace satisfies the pinned oracle.' : 'Execution complete. The measured trace does not satisfy the selected oracle.')
    } catch (error) {
      setStatus('error'); setProgress(error instanceof Error ? error.message : String(error))
    }
  }

  function downloadReceipt() {
    if (!localReceipt) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(localReceipt, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `witness-${capsule.receiptId}-${localReceipt.traceSha256.slice(0, 12)}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800)
  }

  return <div className="app-shell">
    <a className="skip-link" href="#reproducibility-chamber">SKIP TO CHAMBER</a>
    <header className="topbar">
      <a className="wordmark" href="./" aria-label="WITNESS home"><span className="wordmark-mark">W</span><span>WITNESS</span><small>LIVE REPRODUCIBILITY CHAMBER</small></a>
      <div className="topbar-status"><span className={`status-lamp ${status}`} aria-hidden="true"/><span>{statusLabel[status]}</span><span className="build-id">BUILD / 01</span></div>
      <nav aria-label="Project links">
        <a href="https://asp53826.github.io/proofgraph/">PROOFGRAPH <ArrowIcon /></a>
        <a href="https://github.com/asp53826/witness">SOURCE <ArrowIcon /></a>
      </nav>
    </header>

    <main className="lab-grid" id="reproducibility-chamber">
      <aside className="capsule-rack" aria-label="Reproducibility capsules">
        <div className="rack-heading"><span>CAPSULE RACK</span><strong>04 / ONLINE</strong></div>
        {capsules.map((item) => <button key={item.id} className={`capsule-slot ${selected === item.id ? 'active' : ''}`} onClick={() => chooseCapsule(item.id)} disabled={busy} aria-pressed={selected === item.id}>
          <span className="slot-index">{item.index}</span><span className="slot-copy"><b>{item.label}</b><small>{item.system}</small></span><span className="slot-led" aria-hidden="true" />
        </button>)}
        <div className="rack-note"><span>RUNTIME POLICY</span><p>No screenshots. No mocked terminals. Every verdict comes from code executing in this page.</p></div>
      </aside>

      <section className="chamber" aria-labelledby="capsule-title">
        <div className="chamber-rail"><span>SPECIMEN / {capsule.caseNumber}</span><span>PINNED / {capsule.commit.slice(0, 12)}</span><span>ORACLE / DETERMINISTIC</span></div>
        <div className={`chamber-head ${busy ? 'scanning' : ''}`}>
          <div className="head-copy"><p className="eyebrow">{capsule.label} · {capsule.runtime}</p><h1 id="capsule-title">{capsule.title}</h1><p>{capsule.instruction}</p></div>
          <div className="runtime-stamp"><span>EXECUTION MEDIUM</span><strong>{capsule.runtime}</strong><small>{capsule.runtimeDetail}</small></div>
          <div className="scanner" aria-hidden="true" />
        </div>

        <div className="control-strip">
          <button className="run-button" onClick={execute} disabled={busy}><RunIcon /><span>{busy ? 'RUNNING CAPSULE' : result ? 'RUN AGAIN' : 'EXECUTE CAPSULE'}</span><kbd>↵</kbd></button>
          <label className="tamper-switch"><input type="checkbox" checked={invertOracle} onChange={(event) => setInvertOracle(event.target.checked)} disabled={busy}/><span aria-hidden="true"/><b>INVERT EXPECTED VERDICT</b><small>Proves a changed oracle produces a different, failing trace.</small></label>
          <button className="share-button" onClick={copyShareLink}><CopyIcon />{copied ? 'COPIED' : 'COPY CAPSULE LINK'}</button>
        </div>

        <div className="progress-line" role="status" aria-live="polite"><span className={`progress-pulse ${status}`}/><b>{statusLabel[status]}</b><p>{progress}</p></div>

        <div className="evidence-deck">
          <section className="metric-bank" aria-label="Observed metrics">
            <div className="section-label"><span>OBSERVED SIGNALS</span><b>{result ? 'MEASURED' : 'AWAITING RUN'}</b></div>
            <div className="metrics">
              {(result?.metrics ?? [
                { label: 'RECEIPT', value: '—' }, { label: 'RUNTIME', value: '—' }, { label: 'ORACLE', value: '—' }, { label: 'TRACE', value: '—' },
              ]).map((metric) => <div className={`metric ${metric.tone ?? ''}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
            </div>
            <div className={`verdict-plate ${status}`}>
              <span className="verdict-target" aria-hidden="true"><i/><i/><i/></span>
              <div><small>VERDICT</small><strong>{result ? (result.passed ? 'INVARIANT HELD' : 'COUNTEREXAMPLE DETECTED') : 'NO OBSERVATION'}</strong><p>{result?.summary ?? capsule.invariant}</p></div>
            </div>
          </section>

          <section className="trace-console" aria-label="Execution trace">
            <div className="section-label"><span>TRACE / STDOUT</span><b>{capsule.runtime}</b></div>
            <ol>
              {(result?.trace ?? ['Receipt verification has not started.', 'Runtime is cold.', 'Pinned scenario is ready.', 'Oracle comparison is pending.', 'Local receipt will be generated after execution.']).map((line, index) => <li key={`${index}-${line}`}><span>{String(index + 1).padStart(2, '0')}</span><code>{line}</code></li>)}
            </ol>
          </section>
        </div>

        <section className="protocol" aria-labelledby="protocol-title"><div><span className="eyebrow">WHAT THIS RUN PROVES</span><h2 id="protocol-title">One claim. One executable failure. One bounded verdict.</h2></div><p>{capsule.invariant}</p><a href={capsule.testUrl}>INSPECT PINNED TEST <ArrowIcon /></a></section>
      </section>

      <aside className="inspector" aria-label="Integrity inspector">
        <div className="inspector-title"><span>INTEGRITY INSPECTOR</span><b>{receipt?.passed ? 'SEALED' : 'UNVERIFIED'}</b></div>
        <div className="seal"><span className={receipt?.passed ? 'verified' : ''}><i>W</i></span><div><small>COUNTEREXAMPLE RECEIPT</small><strong>{capsule.caseNumber}</strong><p>{capsule.receiptId}</p></div></div>
        <dl className="receipt-checks">{receiptRows.map(([label, ok]) => <div key={label}><dt>{label}</dt><dd className={ok === true ? 'ok' : ok === false ? 'bad' : ''}>{ok === undefined ? 'PENDING' : ok ? <><CheckIcon /> VERIFIED</> : 'FAILED'}</dd></div>)}</dl>
        <div className="hash-block"><span>SUBJECT COMMIT</span><code>{capsule.commit}</code><span>EXPECTED RECEIPT SHA-256</span><code>{shortHash(capsule.expectedReceiptSha256)}</code>{localReceipt && <><span>LOCAL TRACE SHA-256</span><code>{shortHash(localReceipt.traceSha256)}</code></>}</div>
        <div className="inspector-actions">
          <a href={capsule.sourceUrl}><LinkIcon /> PINNED SOURCE</a>
          <a href={`${import.meta.env.BASE_URL}${capsule.receipt}`}><LinkIcon /> CANONICAL RECEIPT</a>
          <button onClick={downloadReceipt} disabled={!localReceipt}><DownloadIcon /> DOWNLOAD RUN RECEIPT</button>
        </div>
        <p className="attestation-note"><b>BOUNDARY</b> The canonical release receipt is provenance-attested. This browser run receipt is deterministic but <strong>local and unattested</strong>.</p>
      </aside>
    </main>

    <footer><div><span>WITNESS / OPEN ENGINEERING EVIDENCE</span><b>Four runtimes. Four pinned commits. Zero invented benchmarks.</b></div><div><a href="https://github.com/asp53826/counterexample">COUNTEREXAMPLE</a><a href="https://asp53826.github.io/">PORTFOLIO</a><span>© 2026 AARYAN PATEL</span></div></footer>
  </div>
}

export default App
