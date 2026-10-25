import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk'

import type { CommandClassModule, FeatureSpec, PropertyNode } from './types.ts'

const identity = (raw: unknown): number | null => (typeof raw === 'number' ? raw : null)

/** Absolute zero, in °C: nothing reported below it is a measurement. */
const ABSOLUTE_ZERO = -273.15

/**
 * A temperature, unless it is physically impossible. Some modules report a
 * sentinel when their probe input is empty — the Qubino Flush modules send
 * -999.9 — and publishing it would plot a radiator at -999.9 °C.
 */
const temperature = (raw: unknown): number | null =>
  typeof raw === 'number' && raw >= ABSOLUTE_ZERO ? raw : null

/**
 * A read-only measurement: one feature, identity conversion by default, and
 * `sampled` because these are the values that flood the state quota (a power
 * meter reporting every few seconds) and where only the latest reading matters.
 */
function measurement(spec: FeatureSpec, convert = identity): PropertyNode {
  return {
    self: {
      expose: [{ name: '', sampled: true, spec }],
      fromZwave: [{ convert }],
    },
  }
}

/** Multilevel Sensor (0x31) — the scalar sensors of a node. */
export const multilevelSensor: CommandClassModule = {
  id: 49,
  name: 'multilevel_sensor',
  properties: {
    air_temperature: measurement(
      {
        category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: -100,
        max: 150,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      temperature,
    ),
    illuminance: measurement({
      category: DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.LUX,
      min: 0,
      max: 100000,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    }),
    power: measurement({
      category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
      type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
      unit: DEVICE_FEATURE_UNITS.WATT,
      min: 0,
      max: 5000,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    }),
  },
}
