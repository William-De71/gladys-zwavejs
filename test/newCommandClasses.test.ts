import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { CommandDispatcher } from '../src/runtime/CommandDispatcher.ts'
import type { ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'
import { buildTopics } from '../src/zwave/topics.ts'
import { createFakeLogger } from './helpers/fakes.ts'

/**
 * Color Switch, Door Lock, Sound Switch, Barrier Operator and Thermostat Fan
 * Mode.
 *
 * The fixtures are real devices (Home Assistant's zwave_js test dumps)
 * converted to the zwave-js-ui shape; the `_comment` of each one says where it
 * comes from, and what — if anything — was added to it.
 */

const SELECTOR = 'test'
const externalId = (suffix: string) => `ext:${SELECTOR}:${suffix}`
const mapper = new DeviceMapper(externalId)
const topics = buildTopics({ prefix: 'zwave', gateway: 'ZWAVE_GATEWAY-zwave-js-ui' })
const WRITE_VALUE = 'zwave/_CLIENTS/ZWAVE_GATEWAY-zwave-js-ui/api/writeValue/set'

const load = (name: string): ZwaveNode =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as ZwaveNode

const bulb = load('colorBulbNode.json')
const lock = load('doorLockNode.json')
const siren = load('sirenNode.json')
const garage = load('garageDoorNode.json')
const fanThermostat = load('fanThermostatNode.json')

const ids = (node: ZwaveNode) =>
  (mapper.toDiscoveredDevice(node).features ?? []).map((feature) =>
    feature.external_id.replace(`ext:${SELECTOR}:${node.id}:`, ''),
  )

const featureOf = (node: ZwaveNode, suffix: string) => {
  const found = (mapper.toDiscoveredDevice(node).features ?? []).find(
    (feature) => feature.external_id === externalId(`${node.id}:${suffix}`),
  )
  assert.ok(found, `${suffix} was not discovered`)
  return found
}

const valueOf = (node: ZwaveNode, property: string, endpoint = 0): ZwaveValue => {
  const found = Object.values(node.values ?? {}).find(
    (value) =>
      value.propertyName === property &&
      (value.endpoint ?? 0) === endpoint &&
      (value.propertyKey === null || value.propertyKey === undefined),
  )
  assert.ok(found, `${property} missing from the fixture`)
  return found
}

/** States published for one raw value, as `suffix → state`. */
const convert = (node: ZwaveNode, property: string, raw: unknown, endpoint = 0) =>
  Object.fromEntries(
    mapper
      .convertValue(node, valueOf(node, property, endpoint), raw)
      .map((state) => [
        state.featureExternalId.replace(`ext:${SELECTOR}:${node.id}:`, ''),
        state.state,
      ]),
  )

function command(node: ZwaveNode, suffix: string, value: number) {
  const published: Array<{ topic: string; payload: unknown }> = []
  const dispatcher = new CommandDispatcher({
    logger: createFakeLogger(),
    selector: SELECTOR,
    externalId,
    topics: () => topics,
    publish: (topic, payload) => published.push({ topic, payload: JSON.parse(payload) }),
    pushStates: () => {},
  })
  const feature = featureOf(node, suffix)
  dispatcher.setValue({ external_id: externalId(String(node.id)) }, feature, value)
  return published
}

// ---------------------------------------------------------------------------
// Color Switch
// ---------------------------------------------------------------------------

test('an RGB bulb gets one colour feature, next to its dimmer, and no per-channel slider', () => {
  assert.deepEqual(ids(bulb), [
    '0:multilevel_switch:currentvalue:position',
    '0:multilevel_switch:currentvalue:state',
    '0:color_switch:hexcolor',
  ])
  const color = featureOf(bulb, '0:color_switch:hexcolor')
  assert.equal(color.category, 'light')
  assert.equal(color.type, 'color')
  assert.equal(color.min, 0)
  assert.equal(color.max, 0xffffff)
  assert.equal(color.read_only, false)
})

test('the reported hex colour becomes the RGB integer Gladys stores', () => {
  assert.deepEqual(convert(bulb, 'hexColor', 'ff8000'), { '0:color_switch:hexcolor': 0xff8000 })
  assert.deepEqual(convert(bulb, 'hexColor', '#00FF00'), { '0:color_switch:hexcolor': 0x00ff00 })
  assert.deepEqual(convert(bulb, 'hexColor', ''), {})
  assert.deepEqual(convert(bulb, 'hexColor', 'red'), {})
})

test('a colour set in Gladys is written as a zero-padded hex string', () => {
  assert.deepEqual(command(bulb, '0:color_switch:hexcolor', 0x0000ff), [
    {
      topic: WRITE_VALUE,
      payload: {
        args: [{ nodeId: 40, commandClass: 51, endpoint: 0, property: 'hexColor' }, '0000ff'],
      },
    },
  ])
  assert.throws(() => command(bulb, '0:color_switch:hexcolor', 0x1000000), /Invalid RGB color/)
})

// ---------------------------------------------------------------------------
// Door Lock
// ---------------------------------------------------------------------------

test('a door lock gets one lock feature built on the reported mode', () => {
  assert.deepEqual(ids(lock), ['0:door_lock:currentmode'])
  const feature = featureOf(lock, '0:door_lock:currentmode')
  assert.equal(feature.category, 'lock')
  assert.equal(feature.type, 'binary')
  assert.equal(feature.read_only, false)
})

test('only Secured reads as locked; every partly unsecured mode reads as unlocked', () => {
  assert.deepEqual(convert(lock, 'currentMode', 255), { '0:door_lock:currentmode': 1 })
  for (const mode of [0, 1, 16, 17, 32, 33]) {
    assert.deepEqual(
      convert(lock, 'currentMode', mode),
      { '0:door_lock:currentmode': 0 },
      `${mode}`,
    )
  }
  assert.deepEqual(convert(lock, 'currentMode', 254), {}, 'Unknown publishes nothing')
})

test('locking and unlocking write targetMode, not the reported mode', () => {
  const target = { nodeId: 41, commandClass: 98, endpoint: 0, property: 'targetMode' }
  assert.deepEqual(command(lock, '0:door_lock:currentmode', 1), [
    { topic: WRITE_VALUE, payload: { args: [target, 255] } },
  ])
  assert.deepEqual(command(lock, '0:door_lock:currentmode', 0), [
    { topic: WRITE_VALUE, payload: { args: [target, 0] } },
  ])
})

// ---------------------------------------------------------------------------
// Sound Switch
// ---------------------------------------------------------------------------

test('a multi-endpoint siren gets one siren per endpoint', () => {
  assert.deepEqual(
    ids(siren),
    [1, 2, 3, 4, 5, 6, 7, 8].map((endpoint) => `${endpoint}:sound_switch:toneid`),
  )
  const feature = featureOf(siren, '2:sound_switch:toneid')
  assert.equal(feature.category, 'siren')
  assert.equal(feature.type, 'binary')
})

test('any tone playing reads as on, tone 0 as off', () => {
  assert.deepEqual(convert(siren, 'toneId', 0, 2), { '2:sound_switch:toneid': 0 })
  assert.deepEqual(convert(siren, 'toneId', 7, 2), { '2:sound_switch:toneid': 1 })
  assert.deepEqual(convert(siren, 'toneId', null, 2), {})
})

test('on plays the default tone of the endpoint, off stops it', () => {
  const target = { nodeId: 42, commandClass: 121, endpoint: 3, property: 'toneId' }
  assert.deepEqual(command(siren, '3:sound_switch:toneid', 1), [
    { topic: WRITE_VALUE, payload: { args: [target, 255] } },
  ])
  assert.deepEqual(command(siren, '3:sound_switch:toneid', 0), [
    { topic: WRITE_VALUE, payload: { args: [target, 0] } },
  ])
})

// ---------------------------------------------------------------------------
// Barrier Operator
// ---------------------------------------------------------------------------

test('a garage door gets an open/close control and an opening sensor', () => {
  assert.deepEqual(ids(garage), [
    '0:barrier_operator:currentstate',
    '0:barrier_operator:currentstate:opening',
  ])
  const control = featureOf(garage, '0:barrier_operator:currentstate')
  assert.equal(control.category, 'shutter')
  assert.equal(control.type, 'state')
  assert.equal(control.read_only, false)
  const sensor = featureOf(garage, '0:barrier_operator:currentstate:opening')
  assert.equal(sensor.category, 'opening-sensor')
  assert.equal(sensor.read_only, true)
})

test('a door that is not fully closed reads as open on the sensor', () => {
  assert.deepEqual(convert(garage, 'currentState', 0), {
    '0:barrier_operator:currentstate': -1,
    '0:barrier_operator:currentstate:opening': 1,
  })
  assert.deepEqual(convert(garage, 'currentState', 255), {
    '0:barrier_operator:currentstate': 1,
    '0:barrier_operator:currentstate:opening': 0,
  })
  assert.deepEqual(convert(garage, 'currentState', 253), {
    '0:barrier_operator:currentstate': 0,
    '0:barrier_operator:currentstate:opening': 0,
  })
  // Still moving: the control keeps the last order, the sensor already says open.
  assert.deepEqual(convert(garage, 'currentState', 254), {
    '0:barrier_operator:currentstate:opening': 0,
  })
})

test('open and close write targetState; stop is refused, the command class has none', () => {
  const target = { nodeId: 43, commandClass: 102, endpoint: 0, property: 'targetState' }
  assert.deepEqual(command(garage, '0:barrier_operator:currentstate', 1), [
    { topic: WRITE_VALUE, payload: { args: [target, 255] } },
  ])
  assert.deepEqual(command(garage, '0:barrier_operator:currentstate', -1), [
    { topic: WRITE_VALUE, payload: { args: [target, 0] } },
  ])
  assert.throws(() => command(garage, '0:barrier_operator:currentstate', 0), /cannot be stopped/)
})

test('the opening sensor of a garage door is not commandable', () => {
  assert.throws(
    () => command(garage, '0:barrier_operator:currentstate:opening', 1),
    /not commandable/,
  )
})

// ---------------------------------------------------------------------------
// Thermostat Fan Mode
// ---------------------------------------------------------------------------

test('a thermostat fan mode becomes an air-conditioning fan speed', () => {
  assert.deepEqual(ids(fanThermostat), ['1:thermostat_fan_mode:mode'])
  const feature = featureOf(fanThermostat, '1:thermostat_fan_mode:mode')
  assert.equal(feature.category, 'air-conditioning')
  assert.equal(feature.type, 'fan-speed')
})

const readFanSpeed = (raw: number) =>
  convert(fanThermostat, 'mode', raw, 1)['1:thermostat_fan_mode:mode']

const writtenFanMode = (speed: number) => {
  const payload = command(fanThermostat, '1:thermostat_fan_mode:mode', speed)[0]?.payload as
    | { args: unknown[] }
    | undefined
  return payload?.args[1]
}

test('the three auto modes read as auto; modes without equivalent publish nothing', () => {
  const read = readFanSpeed
  assert.equal(read(0), 0)
  assert.equal(read(2), 0)
  assert.equal(read(4), 0)
  assert.equal(read(1), 1)
  assert.equal(read(5), 3)
  assert.equal(read(3), 5)
  assert.equal(read(10), 6)
  assert.equal(read(6), undefined)
})

test('a fan speed is written as its Z-Wave mode; speeds without equivalent are refused', () => {
  const written = writtenFanMode
  assert.equal(written(0), 0)
  assert.equal(written(1), 1)
  assert.equal(written(3), 5)
  assert.equal(written(5), 3)
  assert.equal(written(6), 10)
  assert.throws(() => written(7), /no Z-Wave fan mode/)
})
