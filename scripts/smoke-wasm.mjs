import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import createFaultline from '../public/wasm/faultline-engine.mjs'

const wasm = readFileSync(new URL('../public/wasm/faultline-engine.wasm', import.meta.url))
const engine = await createFaultline({ instantiateWasm(imports, success) { WebAssembly.instantiate(wasm, imports).then(({ instance }) => success(instance)) } })
const call = (name, types = [], args = []) => JSON.parse(engine.ccall(name, 'string', types, args))
call('faultline_reset')
const elected = call('faultline_campaign', ['number'], [1])
const before = elected.nodes.find((node) => node.id === 1)
call('faultline_isolate', ['number'], [1])
const observed = call('faultline_propose', ['number', 'string', 'string'], [7, 'account/alice', '90'])
const after = observed.nodes.find((node) => node.id === 1)
assert.equal(after.lastIndex, before.lastIndex + 1, 'isolated leader must append locally')
assert.equal(after.commit, before.commit, 'minority proposal must not advance commit')
assert.equal(observed.dropped, 4, 'partition must drop one message to every follower')
assert.ok(observed.nodes.every((node) => node.digest === ''), 'uncommitted value must remain invisible')
console.log(JSON.stringify({ runtime: observed.engine, localAppend: true, commitHeld: true, visibleValue: false }))
