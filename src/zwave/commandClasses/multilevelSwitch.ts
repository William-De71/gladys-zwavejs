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

/** `restorePrevious` exposed as an on/off, on the nodes that are dimmers. */
const dimmerRestorePreviousProperty: PropertyNode = {
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
// Pilot wire modules. They announce themselves as dimmers (device class 17-1),
// but each range of levels is a pilot wire order: a "30 %" radiator is in eco.
// Exposed as a Gladys pilot wire feature, which is what the thermostat and the
// dashboard know how to drive, on top of the dimmer ones.
// ---------------------------------------------------------------------------

/**
 * Level written for each order. Measured on a Qubino ZMNHJD: any level inside
 * the order's range would do, these are the ones the module itself reports.
 */
const PILOT_WIRE_LEVEL: Readonly<Record<number, number>> = {
  [PILOT_WIRE_MODE.OFF]: 0,
  [PILOT_WIRE_MODE.FROST_PROTECTION]: 20,
  [PILOT_WIRE_MODE.ECO]: 30,
  [PILOT_WIRE_MODE.COMFORT_2]: 40,
  [PILOT_WIRE_MODE.COMFORT_1]: 50,
  [PILOT_WIRE_MODE.COMFORT]: 99,
}

/**
 * The order behind a reported level, read by RANGE: the module may report any
 * level of a range — its own button was seen reporting 60 before 99, and that
 * is a comfort order. Anything outside 0-99 (255 is "last known level") is not
 * an order, and publishes nothing.
 */
function pilotWireModeFromLevel(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 99) {
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
 * The dimmer features — "restore previous" included — are kept next to the
 * order: the raw level stays readable and drivable for whoever wants it, and a
 * module added as a dimmer keeps its features, history and scenes.
 *
 * Their builders MUST stay the default dimmer ones: `resolveCommand()` does not
 * know the node, so a `switch` command on ANY dimmer may resolve through this
 * product variant first.
 */
const pilotWireProperties: PropertyMap = {
  currentvalue: {
    self: {
      expose: [
        dimmerPosition,
        dimmerState,
        {
          name: 'pilot_wire_mode',
          spec: {
            category: DEVICE_FEATURE_CATEGORIES.HEATER,
            type: DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE,
            min: PILOT_WIRE_MODE.OFF,
            max: PILOT_WIRE_MODE.COMFORT,
            read_only: false,
            // The module reports `currentValue` after every change, its own
            // buttons included. Declaring the feedback keeps the core from
            // saving the order on send: a radiator that missed the frame must
            // not look like it obeyed.
            has_feedback: true,
            keep_history: true,
          },
        },
      ],
      fromZwave: [
        ...(dimmerCurrentValue.fromZwave ?? []),
        { featureName: 'pilot_wire_mode', convert: pilotWireModeFromLevel },
      ],
      toZwave: {
        ...dimmerCurrentValue.toZwave,
        pilot_wire_mode: (value) => {
          const level = PILOT_WIRE_LEVEL[value]
          if (level === undefined) {
            throw new Error(`Unknown pilot wire order: ${value}`)
          }
          return sendCommand('set', [level])
        },
      },
    },
  },
  // Turning it on sends the radiator back to the order it last had.
  restoreprevious: dimmerRestorePreviousProperty,
}

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
    '17-1': { restoreprevious: dimmerRestorePreviousProperty },
    // Class A Motor: Window Covering No Position/Endpoint Device Type
    '17-5': shutterProperties,
    // Class B Motor: Window Covering Endpoint Aware Device Type
    '17-6': shutterProperties,
    // Class C Motor: Window Covering Position/Endpoint Aware Device Type
    '17-7': shutterProperties,
  },
  // Keyed on `deviceId`, which zwave-js-ui builds as
  // `<manufacturerId>-<productId>-<productType>`.
  byProduct: {
    // Qubino Flush Pilot ZMNHJD (0x0159 0x0004-0x0051).
    '345-81-4': pilotWireProperties,
  },
}
