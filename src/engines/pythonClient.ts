import type { CapsuleId, RunResult } from '../types'

type PythonCapsule = Extract<CapsuleId, 'autonomy' | 'quant'>
interface WorkerMessage { id: number; type: 'progress' | 'result' | 'error'; message?: string; result?: RunResult }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (result: RunResult) => void; reject: (error: Error) => void; onProgress: (message: string) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(`${import.meta.env.BASE_URL}workers/python-runner.mjs`, { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    if (event.data.type === 'progress') request.onProgress(event.data.message ?? 'Python worker is running.')
    if (event.data.type === 'result' && event.data.result) { request.resolve(event.data.result); pending.delete(event.data.id) }
    if (event.data.type === 'error') { request.reject(new Error(event.data.message ?? 'Python worker failed.')); pending.delete(event.data.id) }
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Python worker crashed.')
    pending.forEach((request) => request.reject(error))
    pending.clear()
    worker?.terminate()
    worker = null
  })
  return worker
}

export function runPythonCapsule(capsule: PythonCapsule, onProgress: (message: string) => void): Promise<RunResult> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ id, capsule })
  })
}
