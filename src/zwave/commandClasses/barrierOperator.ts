import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { COVER_STATE, OPENING_SENSOR_STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'
import { writeValue } from './types.ts'

/** Barrier states reported by `currentState` (zwave-js `BarrierState`). */
const BARRIER_STATE = {
  CLOSED: 0,
  CLOSING: 252,
  STOPPED: 253,
  OPENING: 254,
  OPEN: 255,
} as const

/**
 * Barrier Operator (0x66) — garage doors and gates.
 *
 * `currentState` fans out into two features:
 *
 *  - a shutter control (open / close), whose command writes `targetState`.
 *    The command class has no stop order — only 0 (close) and 255 (open) are
 *    valid targets — so STOP is refused instead of being turned into an order
 *    the door would carry out;
 *  - an opening sensor, for scenes and alarms: anything but fully closed is
 *    open. A door stopped halfway, or still moving, lets someone in.
 */
export const barrierOperator: CommandClassModule = {
  id: 102,
  name: 'barrier_operator',
  properties: {
    currentstate: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
              type: DEVICE_FEATURE_TYPES.SHUTTER.STATE,
              min: COVER_STATE.CLOSE,
              max: COVER_STATE.OPEN,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
          {
            name: 'opening',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
              type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
              min: 0,
              max: 1,
              read_only: true,
              has_feedback: true,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              switch (raw) {
                case BARRIER_STATE.OPEN:
                  return COVER_STATE.OPEN
                case BARRIER_STATE.CLOSED:
                  return COVER_STATE.CLOSE
                case BARRIER_STATE.STOPPED:
                  return COVER_STATE.STOP
                default:
                  // Opening / closing: the move is not over, the last order
                  // still describes it.
                  return null
              }
            },
          },
          {
            featureName: 'opening',
            convert: (raw) => {
              if (typeof raw !== 'number') {
                return null
              }
              return raw === BARRIER_STATE.CLOSED
                ? OPENING_SENSOR_STATE.CLOSE
                : OPENING_SENSOR_STATE.OPEN
            },
          },
        ],
        toZwave: {
          '': (value) => {
            if (value === COVER_STATE.OPEN) {
              return writeValue('targetState', BARRIER_STATE.OPEN)
            }
            if (value === COVER_STATE.CLOSE) {
              return writeValue('targetState', BARRIER_STATE.CLOSED)
            }
            throw new Error('A Z-Wave barrier operator cannot be stopped, only opened or closed')
          },
        },
      },
    },
  },
}
