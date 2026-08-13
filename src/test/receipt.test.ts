import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { capsules } from '../lib/capsules'
import { canonical, sha256 } from '../lib/receipt'
import type { ReceiptDocument } from '../types'

describe('canonical COUNTEREXAMPLE receipts', () => {
  for (const capsule of capsules) {
    it(`verifies ${capsule.caseNumber} receipt and commit binding`, async () => {
      const receipt = JSON.parse(readFileSync(new URL(`../../public/${capsule.receipt}`, import.meta.url), 'utf8')) as ReceiptDocument
      const { receiptSha256, ...unsignedReceipt } = receipt
      expect(receipt.format).toBe('counterexample-receipt/v1')
      expect(receipt.subject.id).toBe(capsule.receiptId)
      expect(receipt.subject.commit).toBe(capsule.commit)
      expect(receipt.subject.commit).toBe(receipt.capsule.commit)
      expect(await sha256(canonical(unsignedReceipt))).toBe(receiptSha256)
      expect(receiptSha256).toBe(capsule.expectedReceiptSha256)
      expect(await sha256(canonical(receipt.capsule))).toBe(receipt.integrity.capsuleSha256)
    })
  }
})
