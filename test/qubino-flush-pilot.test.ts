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
 * Qubino Flush Pilot (ZMNHJD): a pilot wire module that announces itself as a
 * dimmer (device class 17-1). Each range of Multilevel Switch levels is a
 * pilot wire order, so it is exposed as one heater/pilot-wire-mode feature —
 * the only actuator the Gladys thermostat can drive on such a radiator.
 */

const SELECTOR = 'test'
const externalId = (suffix: string) => `ext:${SELECTOR}:${suffix}`
const mapper = new DeviceMapper(externalId)
const PILOT_WIRE_ID = '2:0:multilevel_switch:currentvalue:pilot_wire_mode'

const node = JSON.parse(
  readFileSync(new URL('./fixtures/qubino-zmnhjdNode.json', import.meta.url), 'utf8'),
) as ZwaveNode

const currentValue = (): ZwaveValue => {
  const found = Object.values(node.values ?? {}).find(
    (value) => value.commandClass === 38 && value.propertyName === 'currentValue',
  )
  assert.ok(found, 'Multilevel Switch currentValue missing from the fixture')
  return found
}

const features = () => mapper.toDiscoveredDevice(node).features ?? []

/** The pilot wire states a reported level converts to. */
const ordersFor = (raw: unknown) =>
  mapper
    .convertValue(node, currentValue(), raw)
    .filter((state) => state.featureExternalId === externalId(PILOT_WIRE_ID))
    .map((state) => state.state)

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
  const setValue = (value: number) =>
    dispatcher.setValue(
      { external_id: externalId('2') },
      { external_id: externalId(PILOT_WIRE_ID), category: 'heater', type: 'pilot-wire-mode' },
      value,
    )
  return { setValue, published, states }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test('the Flush Pilot exposes a pilot wire feature instead of the dimmer ones', () => {
  assert.deepEqual(
    features().map((feature) => feature.external_id.replace(externalId('2:0:'), '')),
    [
      'multilevel_switch:currentvalue:pilot_wire_mode',
      'multilevel_sensor:air_temperature',
      'binary_sensor:any',
    ],
  )
})

test('the pilot wire feature is a writable heater order with feedback', () => {
  const pilotWire = features().find((feature) => feature.external_id === externalId(PILOT_WIRE_ID))

  assert.deepEqual(
    { ...pilotWire, name: undefined, external_id: undefined },
    {
      category: 'heater',
      type: 'pilot-wire-mode',
      min: PILOT_WIRE_MODE.OFF,
      max: PILOT_WIRE_MODE.COMFORT,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      name: undefined,
      external_id: undefined,
    },
  )
})

test('another product of the dimmer class is still published as a dimmer', () => {
  const dimmer = mapper.toDiscoveredDevice({ ...node, deviceId: '345-82-1' })

  assert.deepEqual(
    (dimmer.features ?? [])
      .filter((feature) => feature.external_id.includes(':multilevel_switch:'))
      .map((feature) => `${feature.category}/${feature.type}`),
    ['switch/dimmer', 'switch/binary', 'switch/binary'],
  )
})

// ---------------------------------------------------------------------------
// Gladys → device
// ---------------------------------------------------------------------------

test('each order is written as its level through the Multilevel Switch set command', () => {
  const levels: Array<[number, number]> = [
    [PILOT_WIRE_MODE.OFF, 0],
    [PILOT_WIRE_MODE.FROST_PROTECTION, 20],
    [PILOT_WIRE_MODE.ECO, 30],
    [PILOT_WIRE_MODE.COMFORT_2, 40],
    [PILOT_WIRE_MODE.COMFORT_1, 50],
    [PILOT_WIRE_MODE.COMFORT, 99],
  ]
  for (const [order, level] of levels) {
    const { setValue, published } = setup()
    setValue(order)
    assert.deepEqual(
      published,
      [{ args: [{ nodeId: 2, commandClass: 38, endpoint: 0 }, 'set', [level]] }],
      `order ${order}`,
    )
  }
})

test('an unknown order fails the command and sends nothing', () => {
  const { setValue, published } = setup()

  assert.throws(() => setValue(6), /Unknown pilot wire order/)
  assert.deepEqual(published, [])
})

test('no state is published on send: the module confirms through currentValue', () => {
  const { setValue, states } = setup()

  setValue(PILOT_WIRE_MODE.ECO)

  assert.deepEqual(states, [])
})

// ---------------------------------------------------------------------------
// Device → Gladys
// ---------------------------------------------------------------------------

test('a reported level is read as the order of its range', () => {
  const expected: Array<[number, number]> = [
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
    // Seen when pressing the module's own button, before it settles on 99.
    [60, PILOT_WIRE_MODE.COMFORT],
    [99, PILOT_WIRE_MODE.COMFORT],
  ]
  for (const [level, order] of expected) {
    assert.deepEqual(ordersFor(level), [order], `level ${level}`)
  }
})

test('a level outside 0-99 publishes nothing', () => {
  for (const raw of [255, -1, 30.5, '30', null, true]) {
    assert.deepEqual(ordersFor(raw), [], `raw ${String(raw)}`)
  }
})

test('the snapshot of the fixture reports the eco order', () => {
  const pilotWire = mapper
    .snapshot(node)
    .filter((state) => state.featureExternalId === externalId(PILOT_WIRE_ID))

  assert.deepEqual(
    pilotWire.map((state) => state.state),
    [PILOT_WIRE_MODE.ECO],
  )
})
