import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { AC_FAN_SPEED } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'
import { writeValue } from './types.ts'

/** Fan modes defined by the Thermostat Fan Mode command class (zwave-js `ThermostatFanMode`). */
const ZWAVE_FAN_MODE = {
  AUTO_LOW: 0,
  LOW: 1,
  AUTO_HIGH: 2,
  HIGH: 3,
  AUTO_MEDIUM: 4,
  MEDIUM: 5,
  QUIET: 10,
} as const

/**
 * Thermostat Fan Mode (0x44) — the fan of an HVAC thermostat.
 *
 * Mapped onto the air-conditioning fan speed, the only Gladys feature that
 * speaks of a fan attached to a climate device. The three Z-Wave "auto" modes
 * (auto low / medium / high: the fan runs when needed, at most at that speed)
 * all read as Auto, and Auto is written back as "auto low", the mode every fan
 * thermostat supports — it is the only one the command class makes mandatory.
 *
 * The modes with no Gladys equivalent (circulation, humidity circulation,
 * left-right, up-down, external circulation) publish nothing, and the Gladys
 * speeds with no Z-Wave equivalent (low-mid, mid-high, turbo) are refused.
 */
export const thermostatFanMode: CommandClassModule = {
  id: 68,
  name: 'thermostat_fan_mode',
  properties: {
    mode: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
              type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED,
              min: AC_FAN_SPEED.AUTO,
              max: AC_FAN_SPEED.QUIET,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              switch (raw) {
                case ZWAVE_FAN_MODE.AUTO_LOW:
                case ZWAVE_FAN_MODE.AUTO_MEDIUM:
                case ZWAVE_FAN_MODE.AUTO_HIGH:
                  return AC_FAN_SPEED.AUTO
                case ZWAVE_FAN_MODE.LOW:
                  return AC_FAN_SPEED.LOW
                case ZWAVE_FAN_MODE.MEDIUM:
                  return AC_FAN_SPEED.MID
                case ZWAVE_FAN_MODE.HIGH:
                  return AC_FAN_SPEED.HIGH
                case ZWAVE_FAN_MODE.QUIET:
                  return AC_FAN_SPEED.QUIET
                default:
                  return null
              }
            },
          },
        ],
        toZwave: {
          '': (value) => {
            switch (value) {
              case AC_FAN_SPEED.AUTO:
                return writeValue('mode', ZWAVE_FAN_MODE.AUTO_LOW)
              case AC_FAN_SPEED.LOW:
                return writeValue('mode', ZWAVE_FAN_MODE.LOW)
              case AC_FAN_SPEED.MID:
                return writeValue('mode', ZWAVE_FAN_MODE.MEDIUM)
              case AC_FAN_SPEED.HIGH:
                return writeValue('mode', ZWAVE_FAN_MODE.HIGH)
              case AC_FAN_SPEED.QUIET:
                return writeValue('mode', ZWAVE_FAN_MODE.QUIET)
              default:
                throw new Error(`Fan speed ${value} has no Z-Wave fan mode`)
            }
          },
        },
      },
    },
  },
}
