import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { CommandDispatcher } from '../src/runtime/CommandDispatcher.ts'
import type { PendingState } from '../src/runtime/state.ts'
import type { ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'
import { PILOT_WIRE_MODE } from '../src/zwave/stateValues.ts'
import { buildTopics } from '../src/zwave/topics.ts'
import { createFakeLogger } from './helpers/fakes.ts'

/**
 * Qubino Flush Pilot: drives an electric radiator through its pilot wire. It
 * announces itself as a dimmer (device class 17-1) and takes a Multilevel
 * Switch level, each range of which is one pilot wire order.
 *
 * Runs against `qubino-zmnhjdNode.json`, a real ZMNHJD export from Z-Wave JS
 * UI, sitting in eco (level 30) with no temperature probe wired (-999.9). Its
 * own fixture because exampleNodes.json feeds the golden test.
 */

const SELECTOR = 'test'
const externalId = (suffix: string) => `ext:${SELECTOR}:${suffix}`
const mapper = new DeviceMapper(externalId)

const PILOT_WIRE = '2:0:multilevel_switch:currentvalue'

const readNode = (): ZwaveNode =>
  JSON.parse(
    readFileSync(new URL('./fixtures/qubino-zmnhjdNode.json', import.meta.url), 'utf8'),
  ) as ZwaveNode

const node = readNode()

const valueOf = (commandClass: number, property: string): ZwaveValue => {
  const found = Object.values(node.values ?? {}).find(
    (value) => value.commandClass === commandClass && value.property === property,
  )
  assert.ok(found, `value ${commandClass}/${property} missing from the fixture`)
  return found
}

const featureIds = (subject: ZwaveNode) =>
  (mapper.toDiscoveredDevice(subject).features ?? []).map((entry) =>
    entry.external_id.replace(externalId(`${subject.id}:0:`), ''),
  )

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test('the Flush Pilot exposes one pilot wire feature, and nothing of a dimmer', () => {
  const ids = featureIds(node)

  assert.ok(ids.includes('multilevel_switch:currentvalue'))
  assert.deepEqual(
    ids.filter((id) => id.startsWith('multilevel_switch:') || id.startsWith('binary_switch:')),
    ['multilevel_switch:currentvalue'],
    'no position, no on/off, no "restore previous", no Binary Switch duplicate',
  )
})

test('the pilot wire feature is a commandable heater mode, from off to comfort', () => {
  const pilotWire = (mapper.toDiscoveredDevice(node).features ?? []).find(
    (entry) => entry.external_id === externalId(PILOT_WIRE),
  )
  assert.ok(pilotWire)

  assert.equal(pilotWire.category, 'heater')
  assert.equal(pilotWire.type, 'pilot-wire-mode')
  assert.deepEqual([pilotWire.min, pilotWire.max], [PILOT_WIRE_MODE.OFF, PILOT_WIRE_MODE.COMFORT])
  assert.equal(pilotWire.read_only, false)
  assert.equal(pilotWire.keep_history, true)
  assert.equal(pilotWire.name, '2-38-0-currentValue')
})

test('the wired input is an input, not a motion sensor', () => {
  const input = (mapper.toDiscoveredDevice(node).features ?? []).find(
    (entry) => entry.external_id === externalId('2:0:binary_sensor:any'),
  )
  assert.ok(input, 'same external id as before: only the category changes')

  assert.equal(input.category, 'input')
  assert.equal(input.type, 'binary')
  assert.equal(input.read_only, true)
  assert.deepEqual([input.min, input.max], [0, 1])
})

test('the input state reads as on/off', () => {
  const any = valueOf(48, 'Any')
  const stateOf = (raw: unknown) =>
    mapper.convertValue(node, any, raw).map((state) => [state.featureExternalId, state.state])

  assert.deepEqual(stateOf(true), [[externalId('2:0:binary_sensor:any'), 1]])
  assert.deepEqual(stateOf(false), [[externalId('2:0:binary_sensor:any'), 0]])
  assert.deepEqual(stateOf(null), [])
})

test('every Flush Pilot version is a pilot wire, the DIN rail one and the first one included', () => {
  for (const [productId, model] of [
    [1, 'ZMNHJA'],
    [82, 'ZMNHUD'],
  ] as const) {
    const other: ZwaveNode = { ...readNode(), productId, deviceId: `345-${productId}-4` }
    assert.ok(featureIds(other).includes('multilevel_switch:currentvalue'), model)
    assert.equal(
      mapper
        .toDiscoveredDevice(other)
        .features?.find((entry) => entry.external_id.endsWith(':binary_sensor:any'))?.category,
      'input',
      model,
    )
  }
})

test('the product is recognized from its ids alone, as a node event carries it', () => {
  // A cold cache only knows the node from an event: no `deviceId` there.
  const { deviceId: _deviceId, ...withoutDeviceId } = readNode()

  assert.ok(featureIds(withoutDeviceId).includes('multilevel_switch:currentvalue'))
})

test('another product of the same device class is still a dimmer', () => {
  const dimmer: ZwaveNode = { ...readNode(), productId: 83, deviceId: '345-83-4' }

  assert.deepEqual(
    featureIds(dimmer).filter((id) => id.startsWith('multilevel_switch:')),
    [
      'multilevel_switch:currentvalue:position',
      'multilevel_switch:currentvalue:state',
      'multilevel_switch:restoreprevious',
    ],
  )
})

test('on another product, "Any" is still a motion sensor', () => {
  const sensor: ZwaveNode = { ...readNode(), productId: 83, deviceId: '345-83-4' }

  assert.equal(
    mapper
      .toDiscoveredDevice(sensor)
      .features?.find((entry) => entry.external_id.endsWith(':binary_sensor:any'))?.category,
    'motion-sensor',
  )
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const modeOf = (raw: unknown) =>
  mapper
    .convertValue(node, valueOf(38, 'currentValue'), raw)
    .map((state) => [state.featureExternalId, state.state])

test('each range of levels reads as its pilot wire order, bounds included', () => {
  const cases: Array<[number, number]> = [
    [0, PILOT_WIRE_MODE.OFF],
    [10, PILOT_WIRE_MODE.OFF],
    [11, PILOT_WIRE_MODE.FROST_PROTECTION],
    [20, PILOT_WIRE_MODE.FROST_PROTECTION],
    [21, PILOT_WIRE_MODE.ECO],
    [30, PILOT_WIRE_MODE.ECO],
    [31, PILOT_WIRE_MODE.COMFORT_2],
    [40, PILOT_WIRE_MODE.COMFORT_2],
    [41, PILOT_WIRE_MODE.COMFORT_1],
    [50, PILOT_WIRE_MODE.COMFORT_1],
    [51, PILOT_WIRE_MODE.COMFORT],
    [60, PILOT_WIRE_MODE.COMFORT],
    [99, PILOT_WIRE_MODE.COMFORT],
  ]
  for (const [level, mode] of cases) {
    assert.deepEqual(modeOf(level), [[externalId(PILOT_WIRE), mode]], `level ${level}`)
  }
})

test('a level outside the Multilevel Switch range is no order', () => {
  assert.deepEqual(modeOf(255), [])
  assert.deepEqual(modeOf(-1), [])
  assert.deepEqual(modeOf(null), [])
})

test('a newly created Flush Pilot shows its order, and no impossible temperature', () => {
  const snapshot = new Map(
    mapper.snapshot(node).map((state) => [state.featureExternalId, state.state]),
  )

  assert.equal(snapshot.get(externalId(PILOT_WIRE)), PILOT_WIRE_MODE.ECO)
  assert.equal(
    snapshot.has(externalId('2:0:multilevel_sensor:air_temperature')),
    false,
    '-999.9 means no probe wired, not a temperature',
  )
})

test('the pilot wire order is neither sampled nor an event', () => {
  assert.deepEqual(
    mapper.convertValue(node, valueOf(38, 'currentValue'), 30).map((s) => [s.sampled, s.event]),
    [[false, false]],
  )
})

// ---------------------------------------------------------------------------
// Commanding
// ---------------------------------------------------------------------------

function setup() {
  const published: unknown[] = []
  const states: PendingState[] = []
  const dispatcher = new CommandDispatcher({
    logger: createFakeLogger(),
    selector: SELECTOR,
    externalId,
    topics: () => buildTopics({ prefix: 'zwave', gateway: 'ZWAVE_GATEWAY-zwave-js-ui' }),
    publish: (_topic, payload) => published.push(JSON.parse(payload)),
    pushStates: (pending) => states.push(...pending),
  })
  return { dispatcher, published, states }
}

const pilotWireFeature = {
  external_id: externalId(PILOT_WIRE),
  category: 'heater',
  type: 'pilot-wire-mode',
}
const device = { external_id: externalId('2') }

test('each order sets a level inside its own range, without the node cache', () => {
  const expected: Array<[number, number]> = [
    [PILOT_WIRE_MODE.OFF, 0],
    [PILOT_WIRE_MODE.FROST_PROTECTION, 20],
    [PILOT_WIRE_MODE.ECO, 30],
    [PILOT_WIRE_MODE.COMFORT_2, 40],
    [PILOT_WIRE_MODE.COMFORT_1, 50],
    [PILOT_WIRE_MODE.COMFORT, 99],
  ]
  for (const [mode, level] of expected) {
    const { dispatcher, published, states } = setup()

    dispatcher.setValue(device, pilotWireFeature, mode)

    assert.deepEqual(
      published,
      [{ args: [{ nodeId: 2, commandClass: 38, endpoint: 0 }, 'set', [level]] }],
      `order ${mode}`,
    )
    assert.deepEqual(states, [], 'no dimmer sibling to keep in sync')
    assert.deepEqual(modeOf(level), [[externalId(PILOT_WIRE), mode]], 'reads back as sent')
  }
})

test('an unknown order is refused, nothing is sent', () => {
  const { dispatcher, published } = setup()

  assert.throws(() => dispatcher.setValue(device, pilotWireFeature, 6), /pilot wire order/)
  assert.deepEqual(published, [])
})
