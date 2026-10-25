import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import type { Device, DeviceTransportEntry } from '@gladysassistant/integration-sdk'

import { TOPIC_SETTINGS } from '../src/config.ts'
import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { nodeStatus, nodeTransport } from '../src/mapping/transport.ts'
import { TransportPublisher } from '../src/runtime/TransportPublisher.ts'
import { ZwaveIntegration } from '../src/runtime/ZwaveIntegration.ts'
import type { GetNodesResponse, ZwaveNode } from '../src/types/zwave.ts'
import type { NodeRegistry } from '../src/zwave/NodeRegistry.ts'
import { buildTopics } from '../src/zwave/topics.ts'
import { createFakeGladys, createFakeLogger } from './helpers/fakes.ts'

/**
 * The transport badge tells the user, on the device itself, that a node is
 * dead or half-interviewed — facts that were only in the journal before.
 */

const SELECTOR = 'test-selector'
const topics = buildTopics(TOPIC_SETTINGS)
const deviceId = (nodeId: number) => `ext:${SELECTOR}:${nodeId}`

const readNodes = (): ZwaveNode[] =>
  (
    JSON.parse(
      readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'),
    ) as GetNodesResponse
  ).result ?? []

/** The private MQTT entry points; there is no public way in. */
type Internals = {
  onNodes(message: GetNodesResponse): Promise<void>
  onMessage(topic: string, payload: string): void
  onBrokerDisconnected(reason: string): void
  registry: NodeRegistry
}

/** An integration that knows the given nodes as devices the user created. */
function setup(createdNodeIds: readonly number[]) {
  const fake = createFakeGladys(SELECTOR)
  const integration = new ZwaveIntegration(fake.gladys, createFakeLogger())
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)
  for (const node of readNodes().filter((candidate) => createdNodeIds.includes(candidate.id))) {
    integration.onDeviceUpdated(mapper.toDiscoveredDevice(node) as Device)
  }
  return { ...fake, integration, internals: integration as unknown as Internals }
}

const sent = (batches: DeviceTransportEntry[][]) => batches.flat()

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

test('the status is read in both zwave-js-ui dialects', () => {
  // getNodes names it, node events carry the raw zwave-js enum.
  assert.equal(nodeStatus('Asleep'), 'asleep')
  assert.equal(nodeStatus('Dead'), 'dead')
  assert.equal(nodeStatus(1), 'asleep')
  assert.equal(nodeStatus(3), 'dead')
  assert.equal(nodeStatus(4), 'alive')
  assert.equal(nodeStatus(42), 'unknown')
  assert.equal(nodeStatus(undefined), 'unknown')
})

test('only a dead node is unreachable; a sleeping one is nominal', () => {
  assert.deepEqual(nodeTransport({ id: 1, ready: true, status: 'Dead' }), {
    transport: 'unreachable',
  })
  assert.deepEqual(nodeTransport({ id: 1, ready: true, status: 'Asleep' }), { transport: 'local' })
  assert.deepEqual(nodeTransport({ id: 1, ready: true, status: 'Alive' }), { transport: 'local' })
})

test('an unknown status says nothing rather than guess', () => {
  assert.equal(nodeTransport({ id: 1, ready: true, status: 'Unknown' }), undefined)
  assert.equal(nodeTransport({ id: 1, ready: true }), undefined)
})

test('a node whose interview is unfinished is flagged degraded', () => {
  const transport = nodeTransport({ id: 1, ready: false, status: 'Alive' })
  assert.equal(transport?.transport, 'local')
  assert.equal(transport?.degraded, true)
  assert.ok(transport?.message?.en)
  assert.ok(transport?.message?.fr)
})

test('the broadcast pseudo-nodes get no badge', () => {
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)
  assert.equal(
    mapper.toTransport({ id: 255, virtual: true, ready: true, status: 'Alive' }),
    undefined,
  )
})

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

test('a full node list publishes the badge of the created devices only', async () => {
  const { transports, integration, internals } = setup([5, 50])

  await internals.onNodes({ success: true, result: readNodes() })
  await delay(0)

  assert.deepEqual(
    sent(transports).toSorted((a, b) => a.external_id.localeCompare(b.external_id)),
    [
      { external_id: deviceId(5), transport: 'local' },
      { external_id: deviceId(50), transport: 'local' },
    ],
  )

  await integration.stop()
})

test('an unchanged badge is not sent again', async () => {
  const { transports, integration, internals } = setup([5])

  await internals.onNodes({ success: true, result: readNodes() })
  await internals.onNodes({ success: true, result: readNodes() })
  await delay(0)

  assert.equal(sent(transports).length, 1)

  await integration.stop()
})

test('node_dead turns the badge unreachable without dropping the node values', async () => {
  const { transports, integration, internals } = setup([5])
  await internals.onNodes({ success: true, result: readNodes() })
  const valuesBefore = Object.keys(internals.registry.get(5)?.values ?? {}).length

  // What zwave-js-ui actually sends: the node WITHOUT values, `ready: true`,
  // and the numeric zwave-js status. Through `upsert` this would amputate it.
  internals.onMessage(
    `${topics.nodeEvents}/node_dead`,
    JSON.stringify({ data: [{ id: 5, ready: true, status: 3 }] }),
  )
  await delay(0)

  assert.deepEqual(sent(transports).at(-1), { external_id: deviceId(5), transport: 'unreachable' })
  assert.ok(valuesBefore > 0)
  assert.equal(Object.keys(internals.registry.get(5)?.values ?? {}).length, valuesBefore)

  internals.onMessage(
    `${topics.nodeEvents}/node_alive`,
    JSON.stringify({ data: [{ id: 5, ready: true, status: 4 }] }),
  )
  await delay(0)

  assert.deepEqual(sent(transports).at(-1), { external_id: deviceId(5), transport: 'local' })

  await integration.stop()
})

test('losing the broker leaves the badges alone', async () => {
  // The connection status already says the broker is down. Marking every
  // device unreachable used to leave some stuck there: a node whose status is
  // still Unknown after the reconnection publishes nothing to undo it, and an
  // MQTT error does not always mean a reconnection, hence no getNodes either.
  const { transports, integration, internals } = setup([5, 50])
  await internals.onNodes({ success: true, result: readNodes() })
  await delay(0)
  transports.length = 0

  internals.onBrokerDisconnected('broker unreachable')
  await delay(0)

  assert.deepEqual(sent(transports), [])

  await integration.stop()
})

test('a node leaving the network marks its device unreachable', async () => {
  const { transports, integration, internals } = setup([5])
  await internals.onNodes({ success: true, result: readNodes() })

  internals.onMessage(`${topics.nodeEvents}/node_removed`, JSON.stringify({ data: [{ id: 5 }] }))
  await delay(0)

  assert.deepEqual(sent(transports).at(-1), { external_id: deviceId(5), transport: 'unreachable' })

  await integration.stop()
})

test('a device created later gets its badge right away', async () => {
  const { transports, integration, internals } = setup([])
  await internals.onNodes({ success: true, result: readNodes() })
  await delay(0)
  assert.deepEqual(sent(transports), [])

  const node = readNodes().find((candidate) => candidate.id === 50)
  assert.ok(node)
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)
  integration.onDeviceCreated(mapper.toDiscoveredDevice(node) as Device)
  await delay(0)

  assert.deepEqual(sent(transports), [{ external_id: deviceId(50), transport: 'local' }])

  await integration.stop()
})

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

test('a badge Gladys refused is retried without waiting for a report', async () => {
  // A dead node never reports again: "the next report" would be never.
  const batches: DeviceTransportEntry[][] = []
  let fail = true
  const publisher = new TransportPublisher({
    logger: createFakeLogger(),
    knownDevices: () => new Set([deviceId(1)]),
    retryDelayMs: 10,
    publish: async (entries) => {
      if (fail) {
        fail = false
        throw new Error('boom')
      }
      batches.push(entries)
    },
  })
  const entry: DeviceTransportEntry = { external_id: deviceId(1), transport: 'unreachable' }

  publisher.push([entry])
  await publisher.idle()
  assert.deepEqual(batches, [])

  await delay(30)
  await publisher.idle()
  assert.deepEqual(batches, [[entry]])

  await publisher.stop()
})

test('the latest entry of a device wins over one still waiting', async () => {
  const batches: DeviceTransportEntry[][] = []
  const publisher = new TransportPublisher({
    logger: createFakeLogger(),
    knownDevices: () => new Set([deviceId(1)]),
    publish: async (entries) => {
      batches.push(entries)
    },
  })

  publisher.push([{ external_id: deviceId(1), transport: 'unreachable' }])
  publisher.push([{ external_id: deviceId(1), transport: 'local' }])
  await publisher.idle()

  assert.deepEqual(batches.flat().at(-1), { external_id: deviceId(1), transport: 'local' })
})

test('a request in flight across a reset does not count for the new session', async () => {
  const batches: DeviceTransportEntry[][] = []
  const { promise: held, resolve: release } = Promise.withResolvers<void>()
  let hold = true
  const publisher = new TransportPublisher({
    logger: createFakeLogger(),
    knownDevices: () => new Set([deviceId(1)]),
    publish: async (entries) => {
      if (hold) {
        hold = false
        await held
      }
      batches.push(entries)
    },
  })
  const entry: DeviceTransportEntry = { external_id: deviceId(1), transport: 'local' }

  publisher.push([entry])
  await delay(0)
  // Gladys reconnects while the request is still pending.
  publisher.reset()
  release()
  await publisher.idle()

  publisher.push([entry])
  await publisher.idle()

  assert.equal(batches.length, 2, 'the new session must receive the badge too')
})

test('a stopped publisher sends nothing until it is reset', async () => {
  const batches: DeviceTransportEntry[][] = []
  const publisher = new TransportPublisher({
    logger: createFakeLogger(),
    knownDevices: () => new Set([deviceId(1)]),
    publish: async (entries) => {
      batches.push(entries)
    },
  })
  const entry: DeviceTransportEntry = { external_id: deviceId(1), transport: 'local' }

  await publisher.stop()
  publisher.push([entry])
  await publisher.idle()
  assert.deepEqual(batches, [])

  publisher.reset()
  publisher.push([entry])
  await publisher.idle()
  assert.deepEqual(batches, [[entry]])
})

test('large networks are split in batches of 100', async () => {
  const batches: DeviceTransportEntry[][] = []
  const ids = Array.from({ length: 150 }, (_, index) => deviceId(index + 1))
  const publisher = new TransportPublisher({
    logger: createFakeLogger(),
    knownDevices: () => new Set(ids),
    publish: async (entries) => {
      batches.push(entries)
    },
  })

  publisher.push(ids.map((id) => ({ external_id: id, transport: 'local' as const })))
  await publisher.idle()

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 50],
  )
})
