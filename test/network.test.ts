// The fixtures are copied with a change, never mutated: other tests read them too.
// oxlint-disable no-map-spread
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import { validateWidgetContent } from '@gladysassistant/integration-sdk'

import { TOPIC_SETTINGS } from '../src/config.ts'
import {
  NetworkOperations,
  SCENE_ACTIONS,
  SCENE_ACTION_TIMEOUTS_S,
} from '../src/runtime/NetworkOperations.ts'
import {
  buildNetworkWidget,
  NETWORK_WIDGET,
  summarizeNetwork,
} from '../src/runtime/networkHealth.ts'
import { SCENE_TRIGGERS, ZwaveIntegration } from '../src/runtime/ZwaveIntegration.ts'
import type { GetNodesResponse, ZwaveNode } from '../src/types/zwave.ts'
import { NodeRegistry } from '../src/zwave/NodeRegistry.ts'
import { ZwaveApi } from '../src/zwave/ZwaveApi.ts'
import { buildTopics, type ZwaveApiName } from '../src/zwave/topics.ts'
import { createFakeGladys, createFakeLogger } from './helpers/fakes.ts'

/**
 * Everything about the network as a whole: the zwave-js-ui API calls, the
 * scene actions and triggers, and the network widget.
 */

const SELECTOR = 'test-selector'
const topics = buildTopics(TOPIC_SETTINGS)
const API_ROOT = 'zwave/_CLIENTS/ZWAVE_GATEWAY-zwave-js-ui/api'

const readNodes = (): ZwaveNode[] =>
  (
    JSON.parse(
      readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'),
    ) as GetNodesResponse
  ).result ?? []

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
) as {
  gladys_version: string
  scene_actions: Array<{ key: string; timeout_seconds: number; outputs?: Array<{ key: string }> }>
  scene_triggers: Array<{
    key: string
    fields?: Array<{ key: string }>
    variables: Array<{ key: string }>
  }>
  widgets: Array<{ key: string }>
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/** A ZwaveApi over a recorded broker, with timers the test fires by hand. */
function apiSetup({ connected = true } = {}) {
  const sent: Array<{ topic: string; payload: { args: unknown[]; requestId: string } }> = []
  const timers: Array<() => void> = []
  const api = new ZwaveApi({
    topics: () => topics,
    publish: (topic, payload) => {
      sent.push({ topic, payload: JSON.parse(payload) })
      return connected
    },
    setTimeout: ((callback: () => void) => {
      timers.push(callback)
      return { unref() {} } as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout,
  })
  /** What zwave-js-ui publishes back: the request echoed in `origin`. */
  const answer = (index: number, response: Record<string, unknown>) =>
    api.handle({ ...response, origin: sent[index]?.payload })
  return { api, sent, timers, answer }
}

test('an API call is published on <api>/set with its arguments and a request id', () => {
  const { api, sent } = apiSetup()
  void api.call('pingNode', [5])
  assert.equal(sent[0]?.topic, `${API_ROOT}/pingNode/set`)
  assert.deepEqual(sent[0]?.payload.args, [5])
  assert.match(sent[0]?.payload.requestId ?? '', /^gladys-/)
})

test('each answer resolves its own call, whatever the order', async () => {
  const { api, answer } = apiSetup()
  const first = api.call('pingNode', [5])
  const second = api.call('pingNode', [6])
  assert.equal(answer(1, { success: true, result: false }), true)
  assert.equal(answer(0, { success: true, result: true }), true)
  assert.equal(await first, true)
  assert.equal(await second, false)
})

test('an answer that is not ours is left alone', () => {
  const { api } = apiSetup()
  void api.call('pingNode', [5])
  assert.equal(api.handle({ success: true, result: true, origin: { args: [5] } }), false)
  assert.equal(api.handle({ success: true, origin: { requestId: 'someone-else' } }), false)
  assert.equal(api.handle(null), false)
})

test('a failure reported by zwave-js-ui rejects with its message', async () => {
  const { api, answer } = apiSetup()
  const call = api.call('rebuildNodeRoutes', [5])
  answer(0, { success: false, message: 'Node 5 not found' })
  await assert.rejects(call, /Node 5 not found/)
})

test('no answer in time rejects; a broker down rejects at once', async () => {
  const late = apiSetup()
  const call = late.api.call('pingNode', [5], 10_000)
  late.timers[0]?.()
  await assert.rejects(call, /did not answer pingNode within 10 s/)

  const offline = apiSetup({ connected: false })
  await assert.rejects(offline.api.call('pingNode', [5]), /not connected/)
})

test('losing the link fails every call still waiting', async () => {
  const { api } = apiSetup()
  const calls = [api.call('pingNode', [5]), api.call('refreshValues', [6])]
  api.rejectAll('gone')
  for (const call of calls) {
    // oxlint-disable-next-line no-await-in-loop
    await assert.rejects(call, /gone/)
  }
})

test('the answer topics of the awaited APIs are subscribed, not the whole api branch', () => {
  assert.ok(topics.subscriptions.includes(`${API_ROOT}/pingNode`))
  assert.ok(topics.subscriptions.includes(`${API_ROOT}/rebuildNodeRoutes`))
  assert.ok(!topics.subscriptions.some((topic) => topic.endsWith('/api/#')))
  assert.ok(!topics.subscriptions.includes(`${API_ROOT}/sendCommand`))
})

// ---------------------------------------------------------------------------
// Scene actions
// ---------------------------------------------------------------------------

/** NetworkOperations over a scripted API: each call answers what `reply` says. */
function operationsSetup(reply: (api: ZwaveApiName, args: readonly unknown[]) => unknown) {
  const calls: Array<{ api: ZwaveApiName; args: readonly unknown[]; timeoutMs?: number }> = []
  const api = {
    call: async (name: ZwaveApiName, args: readonly unknown[], timeoutMs?: number) => {
      calls.push({ api: name, args, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
      return reply(name, args)
    },
  } as unknown as ZwaveApi
  return { operations: new NetworkOperations(api, SELECTOR), calls }
}

const device = (nodeId: number | string) => `ext:${SELECTOR}:${nodeId}`

test('every scene action of the manifest is handled, with the same timeout', () => {
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).toSorted(),
    Object.values(SCENE_ACTIONS).toSorted(),
  )
  for (const action of manifest.scene_actions) {
    assert.equal(action.timeout_seconds, SCENE_ACTION_TIMEOUTS_S[action.key], action.key)
  }
})

test('ping answers whether the node is alive, waiting less than the scene does', async () => {
  const { operations, calls } = operationsSetup(() => true)
  assert.deepEqual(await operations.run('ping_node', { device: device(5) }), { alive: true })
  assert.deepEqual(calls[0]?.args, [5])
  assert.ok((calls[0]?.timeoutMs ?? Infinity) < SCENE_ACTION_TIMEOUTS_S.ping_node! * 1000)
})

test('a device that is not a Z-Wave node of this integration is refused', async () => {
  const { operations, calls } = operationsSetup(() => true)
  await assert.rejects(operations.run('ping_node', {}), /Pick a Z-Wave device/)
  await assert.rejects(
    operations.run('ping_node', { device: 'ext:other:5' }),
    /Pick a Z-Wave device/,
  )
  await assert.rejects(
    operations.run('ping_node', { device: device('5:0:battery:level') }),
    /not a Z-Wave device/,
  )
  assert.equal(calls.length, 0)
})

test('a sleeping node not answering in time is reported as queued, not as a failure', async () => {
  const { operations } = operationsSetup(() => {
    throw new Error('Z-Wave JS UI did not answer refreshValues within 55 s')
  })
  assert.deepEqual(await operations.run('refresh_values', { device: device(9) }), {
    completed: false,
  })
  assert.deepEqual(await operations.run('rebuild_node_routes', { device: device(9) }), {
    completed: false,
    success: false,
  })
})

test('a real failure still fails the action', async () => {
  const { operations } = operationsSetup(() => {
    throw new Error('Node 9 not found')
  })
  await assert.rejects(operations.run('refresh_values', { device: device(9) }), /not found/)
})

test('a configuration parameter is written on the Configuration command class', async () => {
  const { operations, calls } = operationsSetup(() => ({ status: 255 }))
  assert.deepEqual(
    await operations.run('set_config_parameter', { device: device(8), parameter: 12, value: 3 }),
    { completed: true, success: true },
  )
  assert.deepEqual(calls[0], {
    api: 'writeValue',
    args: [{ nodeId: 8, commandClass: 112, endpoint: 0, property: 12 }, 3],
    timeoutMs: 55_000,
  })
})

test('a configuration write the node refuses fails the action', async () => {
  const refused = operationsSetup(() => ({ status: 5 }))
  await assert.rejects(
    refused.operations.run('set_config_parameter', {
      device: device(8),
      parameter: 12,
      value: 300,
    }),
    /refused value 300 for parameter 12/,
  )
  // Older zwave-js-ui answer a bare boolean.
  const legacy = operationsSetup(() => true)
  assert.deepEqual(
    await legacy.operations.run('set_config_parameter', {
      device: device(8),
      parameter: 12,
      value: 3,
    }),
    { completed: true, success: true },
  )
  await assert.rejects(
    legacy.operations.run('set_config_parameter', { device: device(8), parameter: 0, value: 3 }),
    /positive integer/,
  )
})

test('inclusion uses the default strategy unless asked for an insecure one', async () => {
  const { operations, calls } = operationsSetup(() => true)
  assert.deepEqual(await operations.run('start_inclusion', {}), { started: true })
  await operations.run('start_inclusion', { security: 'insecure' })
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      [0, {}],
      [2, {}],
    ],
  )
})

test('stopping stops both inclusion and exclusion', async () => {
  const { operations, calls } = operationsSetup(() => false)
  assert.equal(await operations.run('stop_inclusion_exclusion', {}), undefined)
  assert.deepEqual(
    calls.map((call) => call.api),
    ['stopInclusion', 'stopExclusion'],
  )
})

test('rebuilding the network routes starts beginRebuildingRoutes', async () => {
  const { operations, calls } = operationsSetup(() => true)
  assert.deepEqual(await operations.run('rebuild_network_routes', {}), { started: true })
  assert.equal(calls[0]?.api, 'beginRebuildingRoutes')
})

// ---------------------------------------------------------------------------
// Network overview and widget
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0)

function withProblems(): ZwaveNode[] {
  return readNodes().map((node) => {
    if (node.id === 5) {
      return { ...node, status: 'Dead', lastActive: NOW - 3 * 24 * 3600 * 1000 }
    }
    if (node.id === 2) {
      // Node 2 still publishes `isLow`: its own flag is the source of truth.
      const values = Object.fromEntries(
        Object.entries(node.values ?? {}).map(([id, value]) => [
          id,
          value.commandClass === 128 && value.propertyName === 'isLow'
            ? { ...value, value: true }
            : value.commandClass === 128 && value.propertyName === 'level'
              ? { ...value, value: 8 }
              : value,
        ]),
      )
      return { ...node, values }
    }
    return node
  })
}

test('the overview leaves out the controller and the broadcast node', () => {
  const summary = summarizeNetwork(readNodes())
  assert.equal(summary.total, 8)
  assert.equal(summary.asleep, 5)
  assert.equal(summary.dead, 0)
  assert.equal(summary.lowBattery, 0)
  assert.deepEqual(summary.problems, [])
})

test('dead nodes come first, then low batteries', () => {
  const summary = summarizeNetwork(withProblems())
  assert.equal(summary.dead, 1)
  assert.equal(summary.lowBattery, 1)
  assert.deepEqual(
    summary.problems.map((entry) => [entry.node.id, entry.problem, entry.level]),
    [
      [5, 'dead', undefined],
      [2, 'battery', 8],
    ],
  )
})

test('the widget fits the core vocabulary and budget, in French and in English', () => {
  for (const nodes of [readNodes(), withProblems(), []]) {
    for (const language of ['fr', 'en']) {
      const content = buildNetworkWidget(nodes, { language, now: NOW })
      assert.deepEqual(validateWidgetContent(content), [], `${language}, ${nodes.length} nodes`)
    }
  }
})

test('the widget lists what needs attention, with how long a dead node has been silent', () => {
  const content = buildNetworkWidget(withProblems(), { language: 'fr', now: NOW })
  const status = content.components.find((component) => component.type === 'status')
  assert.deepEqual(status?.type === 'status' ? status.items : undefined, [
    { label: '5 · Volet Roulant', value: 'Ne répond plus (3 j)', color: 'danger' },
    { label: '2 · capteur-ouverture', value: '8 %', color: 'warning' },
  ])
  const english = buildNetworkWidget(withProblems(), { language: 'en-US', now: NOW })
  const englishStatus = english.components.find((component) => component.type === 'status')
  assert.equal(
    englishStatus?.type === 'status' ? englishStatus.items[0]?.value : undefined,
    'Not responding (3 d)',
  )
})

test('a healthy network says so', () => {
  const content = buildNetworkWidget(readNodes(), { language: 'fr', now: NOW })
  const status = content.components.find((component) => component.type === 'status')
  assert.deepEqual(status?.type === 'status' ? status.items : undefined, [
    { label: 'Réseau', value: 'Aucun problème', color: 'success' },
  ])
})

test('more problems than rows: the last row says how many are left', () => {
  const dead = readNodes().map((node) => ({ ...node, status: 'Dead' }))
  const many = Array.from({ length: 3 }, (_, round) =>
    dead.map((node) => ({ ...node, id: node.id + round * 1000 })),
  ).flat()
  const content = buildNetworkWidget(many, { language: 'fr', now: NOW })
  const status = content.components.find((component) => component.type === 'status')
  const items = status?.type === 'status' ? status.items : []
  assert.equal(items.length, 10)
  assert.deepEqual(items.at(-1), { label: '…', value: '15 autres', color: 'neutral' })
})

test('the rebuild button asks for a confirmation', () => {
  const content = buildNetworkWidget(readNodes(), { language: 'en', now: NOW })
  const rebuild = content.components.find(
    (component) => component.type === 'button' && component.action?.key === 'rebuild_routes',
  )
  assert.equal(rebuild?.type === 'button' ? rebuild.action?.confirm : undefined, true)
})

test('the manifest declares the widget and the triggers the code fires', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    [NETWORK_WIDGET],
  )
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).toSorted(),
    Object.values(SCENE_TRIGGERS).toSorted(),
  )
  for (const trigger of manifest.scene_triggers) {
    assert.deepEqual(
      trigger.variables.map((variable) => variable.key),
      ['node_id', 'node_name'],
    )
    // A filter only works on a key the event carries.
    for (const field of trigger.fields ?? []) {
      assert.equal(field.key, 'device')
    }
  }
  assert.equal(manifest.gladys_version, '>=5.3.0')
})

// ---------------------------------------------------------------------------
// Scene triggers
// ---------------------------------------------------------------------------

type Internals = {
  onNodes(message: GetNodesResponse): Promise<void>
  onMessage(topic: string, payload: string): void
  registry: NodeRegistry
}

function integrationSetup() {
  const fake = createFakeGladys(SELECTOR)
  const integration = new ZwaveIntegration(fake.gladys, createFakeLogger())
  return { ...fake, integration, internals: integration as unknown as Internals }
}

const nodeEvent = (internals: Internals, event: string, node: Record<string, unknown>) =>
  internals.onMessage(`${topics.nodeEvents}/${event}`, JSON.stringify({ data: [node] }))

test('a node going dead fires node_dead once; coming back fires node_alive', async () => {
  const { sceneEvents, integration, internals } = integrationSetup()
  await internals.onNodes({ success: true, result: readNodes() })

  nodeEvent(internals, 'node_dead', { id: 5, ready: true, status: 3 })
  nodeEvent(internals, 'node_dead', { id: 5, ready: true, status: 3 })
  nodeEvent(internals, 'node_alive', { id: 5, ready: true, status: 4 })
  await delay(0)

  assert.deepEqual(sceneEvents, [
    {
      key: 'node_dead',
      data: { device: `ext:${SELECTOR}:5`, node_id: 5, node_name: 'Volet Roulant' },
    },
    {
      key: 'node_alive',
      data: { device: `ext:${SELECTOR}:5`, node_id: 5, node_name: 'Volet Roulant' },
    },
  ])
  await integration.stop()
})

test('a node becoming alive without having been dead fires nothing', async () => {
  const { sceneEvents, integration, internals } = integrationSetup()
  await internals.onNodes({
    success: true,
    result: readNodes().map((node) => ({ ...node, status: 'Unknown' })),
  })
  nodeEvent(internals, 'node_alive', { id: 5, ready: true, status: 4 })
  nodeEvent(internals, 'node_wakeup', { id: 2, ready: true, status: 2 })
  await delay(0)
  assert.deepEqual(sceneEvents, [])
  await integration.stop()
})

test('node_added fires for an inclusion, not for a node zwave-js-ui re-announces', async () => {
  const { sceneEvents, integration, internals } = integrationSetup()

  // Before the first getNodes, everything looks new: nothing fires.
  nodeEvent(internals, 'node_added', { id: 77, ready: false })
  await internals.onNodes({ success: true, result: readNodes() })
  // A known node re-announced after a zwave-js-ui restart.
  nodeEvent(internals, 'node_added', { id: 5, ready: false })
  // A real inclusion.
  nodeEvent(internals, 'node_added', { id: 60, ready: false })
  await delay(0)

  assert.deepEqual(sceneEvents, [
    {
      key: 'node_added',
      data: { device: `ext:${SELECTOR}:60`, node_id: 60, node_name: 'Z-Wave node 60' },
    },
  ])
  await integration.stop()
})

test('widget refreshes are spaced: one now, the rest of a burst later in one go', async () => {
  const { widgetRefreshes, integration, internals } = integrationSetup()
  await internals.onNodes({ success: true, result: readNodes() })
  nodeEvent(internals, 'node_dead', { id: 5, ready: true, status: 3 })
  nodeEvent(internals, 'node_alive', { id: 5, ready: true, status: 4 })
  assert.deepEqual(widgetRefreshes, [NETWORK_WIDGET])
  await integration.stop()
})

test('a value report updates the cached node, and when it was last heard from', () => {
  const registry = new NodeRegistry()
  const node2 = readNodes().find((node) => node.id === 2)
  assert.ok(node2)
  registry.replace([node2])
  const level = Object.values(node2.values ?? {}).find(
    (value) => value.commandClass === 128 && value.propertyName === 'level',
  )
  assert.ok(level)

  // getNodes keys the value without the node id; the event names it with it.
  registry.applyValue(2, level.id, 7, NOW)
  const updated = Object.values(registry.get(2)?.values ?? {}).find(
    (value) => value.id === level.id,
  )
  assert.equal(updated?.value, 7)
  assert.equal(registry.get(2)?.lastActive, NOW)

  // An unknown value is not invented.
  const before = Object.keys(registry.get(2)?.values ?? {}).length
  registry.applyValue(2, '2-999-0-nope', 1, NOW)
  assert.equal(Object.keys(registry.get(2)?.values ?? {}).length, before)

  // Older zwave-js-ui publish the values as an array: it stays one.
  const node4 = readNodes().find((node) => node.id === 4)
  assert.ok(node4 && Array.isArray(node4.values))
  registry.replace([node4])
  const level4 = Object.values(node4.values ?? {}).find(
    (value) => value.commandClass === 128 && value.propertyName === 'level',
  )
  assert.ok(level4)
  registry.applyValue(4, level4.id, 55, NOW)
  assert.ok(Array.isArray(registry.get(4)?.values))
  assert.equal(
    Object.values(registry.get(4)?.values ?? {}).find((value) => value.id === level4.id)?.value,
    55,
  )
})
