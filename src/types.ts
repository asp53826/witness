export type CapsuleId = 'systems' | 'ml' | 'autonomy' | 'quant' | 'search' | 'imaging' | 'navigation' | 'numerical'

export type RunStatus = 'idle' | 'verifying' | 'loading' | 'running' | 'passed' | 'failed' | 'error'

export interface CapsuleDefinition {
  id: CapsuleId
  index: string
  caseNumber: string
  receipt: string
  receiptId: string
  label: string
  system: string
  title: string
  runtime: string
  runtimeDetail: string
  repository: string
  commit: string
  invariant: string
  instruction: string
  sourceUrl: string
  testUrl: string
  expectedReceiptSha256: string
}

export interface ReceiptDocument {
  format: string
  subject: { id: string; caseNumber: string; title: string; repository: string; commit: string }
  capsule: Record<string, unknown> & { commit: string }
  integrity: { capsuleSha256: string; releaseBundle: string; verifyReceipt: string; verifyAttestation: string }
  receiptSha256: string
}

export interface ReceiptCheck {
  passed: boolean
  format: boolean
  receiptDigest: boolean
  capsuleDigest: boolean
  commitBinding: boolean
  observedReceiptSha256: string
  observedCapsuleSha256: string
  receipt: ReceiptDocument
}

export interface RunResult {
  passed: boolean
  summary: string
  metrics: Array<{ label: string; value: string; tone?: 'neutral' | 'good' | 'warn' }>
  trace: string[]
  raw: Record<string, unknown>
}

export interface LocalRunReceipt {
  format: 'witness-local-run/v1'
  capsule: CapsuleId
  subjectCommit: string
  runtime: string
  canonicalReceiptSha256: string
  canonicalReceiptVerified: boolean
  oracleInverted: boolean
  result: RunResult
  timestamp: string
  signatureStatus: 'local-unattested'
  traceSha256: string
}
