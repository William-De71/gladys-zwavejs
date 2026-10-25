import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import type { Device } from '@gladysassistant/integration-sdk'

import { TOPIC_SETTINGS } from '../src/config.ts'
import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { ZwaveIntegration } from '../src/runtime/ZwaveIntegration.ts'
import type { GetNodesResponse, ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'
import { buildTopics } from '../src/zwave/topics.ts'
import { createFakeGladys, createFakeLogger } from './helpers/fakes.ts'

/**
 * zwave-js-ui serializes the node of every node event with `zwaveNodeToJSON`:
 * the node fields, `ready` and a numeric status — no `values`, no `deviceId`.
 * Whatever reasons on the node as a whole must therefore use the cached one.
 */

const SELECTOR = 'test-selector'
const topics = buildTopics(TOPIC_SETTINGS)

const readNode = (id: number): ZwaveNode => {
  const { result } = JSON.parse(
    readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'),
  ) as { result: ZwaveNode[] }
  const node = result.find((candidate) => candidate.id === id)
  assert.ok(node, `fixture node ${id}`)
  return node
}

const asEventNode = (node: ZwaveNode): ZwaveNode => {
  const { values: _values, deviceId: _deviceId, ...fields } = node
  return { ...fields, ready: true, status: 4 }
}

/** The private MQTT entry points; there is no public way in. */
type Internals = {
  onNodes(message: GetNodesResponse): Promise<void>
  onMessage(topic: string, payload: string): void
}

test('a value report is converted against the cached node, not the bare event node', async () => {
  // Node 9 still publishes its own `isLow`, so its level must NOT feed the
  // low-battery flag. Judged on the event node, which has no values, it would:
  // a 5% report would raise a warning the node itself does not raise.
  const node = readNode(9)
  const { published, gladys } = createFakeGladys(SELECTOR)
  const integration = new ZwaveIntegration(gladys, createFakeLogger())
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)
  integration.onDeviceUpdated(mapper.toDiscoveredDevice(node) as Device)
  const internals = integration as unknown as Internals

  await internals.onNodes({ success: true, result: [node] })
  await delay(400)
  published.length = 0

  const level = Object.values(node.values ?? {}).find(
    (value) => value.commandClass === 128 && value.property === 'level',
  ) as ZwaveValue
  internals.onMessage(
    `${topics.nodeEvents}/node_value_updated`,
    JSON.stringify({ data: [asEventNode(node), { ...level, newValue: 5 }] }),
  )
  await delay(400)

  assert.deepEqual(
    published.map((state) => [state.device_feature_external_id, state.state]),
    [[`ext:${SELECTOR}:9:0:battery:level`, 5]],
  )

  await integration.stop()
})
