import type { ReceiptCheck, ReceiptDocument } from '../types'

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyReceipt(url: string, expectedSha256: string): Promise<ReceiptCheck> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Receipt fetch failed: HTTP ${response.status}`)
  const receipt = await response.json() as ReceiptDocument
  const { receiptSha256, ...unsignedReceipt } = receipt
  const observedReceiptSha256 = await sha256(canonical(unsignedReceipt))
  const observedCapsuleSha256 = await sha256(canonical(receipt.capsule))
  const checks = {
    format: receipt.format === 'counterexample-receipt/v1',
    receiptDigest: observedReceiptSha256 === receiptSha256 && receiptSha256 === expectedSha256,
    capsuleDigest: observedCapsuleSha256 === receipt.integrity.capsuleSha256,
    commitBinding: receipt.subject.commit === receipt.capsule.commit,
  }
  return { ...checks, passed: Object.values(checks).every(Boolean), observedReceiptSha256, observedCapsuleSha256, receipt }
}
