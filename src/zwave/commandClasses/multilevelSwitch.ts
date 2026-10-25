import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk'

import { COVER_STATE, PILOT_WIRE_MODE, STATE } from '../stateValues.ts'
import type {
  ActionBuilder,
  CommandClassModule,
  ExposedFeature,
  PropertyMap,
  PropertyNode,
  PropertyVariant,
} from './types.ts'
import { sendCommand, writeValue } from './types.ts'

// ---------------------------------------------------------------------------
// Default variant: a dimmer. `currentValue` fans out into a position (0-99)
// and a virtual on/off state, kept coherent by the sibling state updates.
// ---------------------------------------------------------------------------

const dimmerPosition: ExposedFeature = {
  name: 'position',
  // NOT sampled on purpose: while a dimmer ramps, the intermediate positions
  // are what shows the device is actually reacting.
  spec: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.DIMMER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 99,
    read_only: false,
    has_feedback: false,
    keep_history: true,
  },
}

const dimmerState: ExposedFeature = {
  name: 'state',
  spec: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: true,
  },
}

const dimmerCurrentValue: PropertyVariant = {
  expose: [dimmerPosition, dimmerState],
  fromZwave: [
    { featureName: 'position', convert: (raw) => (typeof raw === 'number' ? raw : null) },
    {
      featureName: 'state',
      convert: (raw) => (typeof raw === 'number' && raw > 0 ? STATE.ON : STATE.OFF),
    },
    {
      // A position report also tells whether "restore previous" is now on.
      propertyName: 'restoreprevious',
      convert: (raw) => (typeof raw === 'number' && raw > 0 ? STATE.ON : STATE.OFF),
    },
  ],
  toZwave: {
    state: (value) =>
      value === STATE.ON
        ? sendCommand(
            'set',
            [99],
            [
              { featureName: 'position', value: 99 },
              { propertyName: 'restoreprevious', value: STATE.ON },
            ],
          )
        : sendCommand(
            'set',
            [0],
            [
              { featureName: 'position', value: 0 },
              { propertyName: 'restoreprevious', value: STATE.OFF },
            ],
          ),
    position: (value) =>
      sendCommand(
        'set',
        [value],
        [
          { featureName: 'state', value: value > 0 ? STATE.ON : STATE.OFF },
          { propertyName: 'restoreprevious', value: value > 0 ? STATE.ON : STATE.OFF },
        ],
      ),
  },
}

/**
 * Turning a dimmer ON through `restorePrevious` goes back to the last
 * brightness, exactly like pushing the physical button — the device then
 * reports the new position itself, so there is nothing to synchronize
 * locally. Turning it OFF has no such command: we set 0 and sync the siblings.
 */
const restorePreviousAction: ActionBuilder = (value) =>
  value === STATE.ON
    ? writeValue('restorePrevious', true)
    : sendCommand(
        'set',
        [0],
        [
          { propertyName: 'currentvalue', featureName: 'state', value: STATE.OFF },
          { propertyName: 'currentvalue', featureName: 'position', value: 0 },
        ],
      )

/**
 * Commandable on every multilevel switch, but only EXPOSED as a feature on
 * dimmers (device class 17-1): an empty `expose` means "no feature, but the
 * command exists".
 */
const restorePreviousProperty: PropertyNode = {
  self: { expose: [], toZwave: { '': restorePreviousAction } },
}

// ---------------------------------------------------------------------------
// Window covering motors (device classes 17-5, 17-6, 17-7). Same command
// class, completely different intent — and a colliding value space: a shutter
// state of 0 means STOP, a dimmer state of 0 means OFF.
// ---------------------------------------------------------------------------

const shutterCurrentValue: PropertyVariant = {
  expose: [
    {
      name: 'position',
      spec: {
        category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
        type: DEVICE_FEATURE_TYPES.SHUTTER.POSITION,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 99,
        read_only: false,
        has_feedback: false,
        keep_history: true,
      },
    },
    {
      name: 'state',
      spec: {
        category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
        type: DEVICE_FEATURE_TYPES.SHUTTER.STATE,
        // COVER_STATE spans -1 (close) to 1 (open), 0 being stop. Same
        // convention as the Zigbee2mqtt integration.
        min: -1,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: true,
      },
    },
  ],
  // Only the position is reported back: the shutter state is a command, not a
  // readable value (a moving shutter has no "opening" value to report).
  fromZwave: [
    { featureName: 'position', convert: (raw) => (typeof raw === 'number' ? raw : null) },
  ],
  toZwave: {
    state: (value) => {
      if (value === COVER_STATE.STOP) {
        return sendCommand('stopLevelChange', [])
      }
      if (value === COVER_STATE.OPEN) {
        return sendCommand('set', [99], [{ featureName: 'position', value: 99 }])
      }
      return sendCommand('set', [0], [{ featureName: 'position', value: 0 }])
    },
    position: (value) => sendCommand('set', [value]),
  },
}

const shutterProperties: PropertyMap = {
  currentvalue: { self: shutterCurrentValue },
}

// ---------------------------------------------------------------------------
// Pilot wire modules. Their device class says dimmer (17-1), but the level is
// no brightness: each range of it is one pilot wire order, which the module
// turns into the signal on the radiator's pilot wire — a radiator "at 30 %" is
// in eco. Nothing in the protocol says so, hence a variant per product.
// ---------------------------------------------------------------------------

/**
 * The order behind a level, read by range: any level of a range selects its
 * order, so the module may report one we never wrote (its own buttons). Total
 * over 0-99, the Multilevel Switch range; anything else — 255 is "restore the
 * last level" — is no order.
 */
function pilotWireMode(raw: unknown): number | null {
  if (typeof raw !== 'number' || raw < 0 || raw > 99) {
    return null
  }
  if (raw <= 10) return PILOT_WIRE_MODE.OFF
  if (raw <= 20) return PILOT_WIRE_MODE.FROST_PROTECTION
  if (raw <= 30) return PILOT_WIRE_MODE.ECO
  if (raw <= 40) return PILOT_WIRE_MODE.COMFORT_2
  if (raw <= 50) return PILOT_WIRE_MODE.COMFORT_1
  return PILOT_WIRE_MODE.COMFORT
}

/**
 * The level written for each order: the top of its range, 0 for off. Any
 * level of the range would do; these are the ones the other home automation
 * systems write to this module, so the ones known to work.
 */
const PILOT_WIRE_LEVEL: Readonly<Record<number, number>> = {
  [PILOT_WIRE_MODE.OFF]: 0,
  [PILOT_WIRE_MODE.FROST_PROTECTION]: 20,
  [PILOT_WIRE_MODE.ECO]: 30,
  [PILOT_WIRE_MODE.COMFORT_2]: 40,
  [PILOT_WIRE_MODE.COMFORT_1]: 50,
  [PILOT_WIRE_MODE.COMFORT]: 99,
}

const pilotWireProperties: PropertyMap = {
  currentvalue: {
    self: {
      expose: [
        {
          name: '',
          // NOT sampled: an order is not a measurement, each one matters.
          spec: {
            category: DEVICE_FEATURE_CATEGORIES.HEATER,
            type: DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE,
            min: PILOT_WIRE_MODE.OFF,
            max: PILOT_WIRE_MODE.COMFORT,
            read_only: false,
            has_feedback: false,
            keep_history: true,
          },
        },
      ],
      fromZwave: [{ convert: pilotWireMode }],
      toZwave: {
        '': (value) => {
          const level = PILOT_WIRE_LEVEL[value]
          // Refused rather than rounded: a guessed order could leave a room
          // unheated.
          if (level === undefined) {
            throw new Error(`Unknown pilot wire order: ${value}`)
          }
          return sendCommand('set', [level])
        },
      },
    },
  },
  // Neither exposed nor commandable: "restore the previous level" would send
  // the radiator back to whatever order it had before, which nobody chose.
  restoreprevious: { self: { expose: [] } },
}

/**
 * Qubino Flush Pilot, every version zwave-js knows (`0x0159 0x0004-…`): they
 * share the same configuration and the same level ranges.
 */
const QUBINO_FLUSH_PILOT = {
  ZMNHJA: '345-1-4',
  ZMNHJD: '345-81-4',
  ZMNHUD: '345-82-4',
} as const

/** Multilevel Switch (0x26) — dimmers, window covering motors, pilot wires. */
export const multilevelSwitch: CommandClassModule = {
  id: 38,
  name: 'multilevel_switch',
  properties: {
    currentvalue: { self: dimmerCurrentValue },
    restoreprevious: restorePreviousProperty,
  },
  byDeviceClass: {
    // Dimmers: expose `restorePrevious` explicitly, so the user picks the
    // behavior they want — restore the previous brightness, or plain ON/OFF.
    '17-1': {
      restoreprevious: {
        self: {
          expose: [
            {
              name: '',
              spec: {
                category: DEVICE_FEATURE_CATEGORIES.SWITCH,
                type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
                min: 0,
                max: 1,
                read_only: false,
                has_feedback: false,
                keep_history: true,
              },
            },
          ],
          toZwave: { '': restorePreviousAction },
        },
      },
    },
    // Class A Motor: Window Covering No Position/Endpoint Device Type
    '17-5': shutterProperties,
    // Class B Motor: Window Covering Endpoint Aware Device Type
    '17-6': shutterProperties,
    // Class C Motor: Window Covering Position/Endpoint Aware Device Type
    '17-7': shutterProperties,
  },
  byProduct: {
    [QUBINO_FLUSH_PILOT.ZMNHJA]: pilotWireProperties,
    [QUBINO_FLUSH_PILOT.ZMNHJD]: pilotWireProperties,
    [QUBINO_FLUSH_PILOT.ZMNHUD]: pilotWireProperties,
  },
}
