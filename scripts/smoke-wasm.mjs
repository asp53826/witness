import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import createFaultline from '../public/wasm/faultline-engine.mjs'
import createAnnlite from '../public/wasm/annlite-engine.mjs'

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

const annWasm = readFileSync(new URL('../public/wasm/annlite-engine.wasm', import.meta.url))
const annEngine = await createAnnlite({ instantiateWasm(imports, success) { WebAssembly.instantiate(annWasm, imports).then(({ instance }) => success(instance)); return {} } })
const ann = JSON.parse(annEngine.ccall('annlite_witness_run', 'string'))
assert.equal(ann.engine, 'annlite-cpp17-wasm', 'ANN capsule must execute the C++ WebAssembly engine')
assert.equal(ann.recallMonotone, true, 'recall must be monotone as efSearch increases')
assert.equal(ann.workMonotone, true, 'distance work must be monotone as efSearch increases')
assert.ok(ann.frontier.at(-1).recall > ann.frontier[0].recall, 'larger search budget must recover missed neighbors')
assert.ok(ann.frontier.at(-1).recall >= 0.95, 'high-budget recall must clear the targeted recovery boundary')
console.log(JSON.stringify({ runtime: ann.engine, frontier: ann.frontier, recallMonotone: true, workMonotone: true }))
