import { describe, expect, it } from 'vitest'
import { runTensorForge } from '../engines/tensor'
import { capsules } from '../lib/capsules'

describe('browser-native capsules', () => {
  it('rejects the pinned TensorForge shape mismatch before dispatch', async () => {
    const result = await runTensorForge()
    expect(result.passed).toBe(true)
    expect(result.raw.observed).toBe('matmul1 cannot multiply [8,128] by [127,256]')
  })

  it('keeps eight unique source-bound capsule definitions', () => {
    expect(capsules).toHaveLength(8)
    expect(new Set(capsules.map((capsule) => capsule.commit)).size).toBe(8)
    expect(new Set(capsules.map((capsule) => capsule.expectedReceiptSha256)).size).toBe(8)
  })
})
