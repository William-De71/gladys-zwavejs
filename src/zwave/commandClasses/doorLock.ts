import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { LOCK_STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'
import { writeValue } from './types.ts'

/** Door Lock modes (zwave-js `DoorLockMode`) this module reasons about. */
const DOOR_LOCK_MODE = {
  UNSECURED: 0x00,
  UNKNOWN: 0xfe,
  SECURED: 0xff,
} as const

/**
 * Door Lock (0x62) — motorized locks and electric strikes.
 *
 * The feature lives on `currentMode`, the mode the lock REPORTS, and its
 * command writes `targetMode`: `targetMode` stays empty on most locks until
 * someone writes it, so a feature built on it would never show the real state.
 *
 * Every mode other than Secured counts as unlocked. The "inside / outside
 * unsecured" modes and their "with timeout" variants all mean one side of the
 * door opens right now; calling that "locked" is the reading that lets a
 * burglar in. Unknown (0xFE) publishes nothing rather than a guess.
 */
export const doorLock: CommandClassModule = {
  id: 98,
  name: 'door_lock',
  properties: {
    currentmode: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.LOCK,
              type: DEVICE_FEATURE_TYPES.LOCK.BINARY,
              min: LOCK_STATE.UNLOCKED,
              max: LOCK_STATE.LOCKED,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              if (typeof raw !== 'number' || raw === DOOR_LOCK_MODE.UNKNOWN) {
                return null
              }
              return raw === DOOR_LOCK_MODE.SECURED ? LOCK_STATE.LOCKED : LOCK_STATE.UNLOCKED
            },
          },
        ],
        toZwave: {
          '': (value) =>
            writeValue(
              'targetMode',
              value === LOCK_STATE.LOCKED ? DOOR_LOCK_MODE.SECURED : DOOR_LOCK_MODE.UNSECURED,
            ),
        },
      },
    },
  },
}
