import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'
import { writeValue } from './types.ts'

/** Tone ids with a fixed meaning in the Sound Switch command class. */
const TONE = {
  OFF: 0,
  /** "Play the default tone" — the one picked in the device configuration. */
  DEFAULT: 0xff,
} as const

/**
 * Sound Switch (0x79) — sirens, chimes and doorbells.
 *
 * One on/off siren per endpoint, built on `toneId`: ON plays the default tone,
 * OFF stops whatever plays. The tone itself is chosen in the device
 * configuration (`defaultToneId`), because the tone list differs on every
 * model and the Gladys siren feature has no room for it.
 *
 * Multi-endpoint devices (the Aeotec Siren 6 has eight) get one siren per
 * endpoint, each with its own default tone: that is how the manufacturer
 * meant them to be used — one endpoint for the doorbell, one for the alarm...
 */
export const soundSwitch: CommandClassModule = {
  id: 121,
  name: 'sound_switch',
  properties: {
    toneid: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.SIREN,
              type: DEVICE_FEATURE_TYPES.SIREN.BINARY,
              min: 0,
              max: 1,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) =>
              typeof raw === 'number' ? (raw === TONE.OFF ? STATE.OFF : STATE.ON) : null,
          },
        ],
        toZwave: {
          '': (value) => writeValue('toneId', value === STATE.ON ? TONE.DEFAULT : TONE.OFF),
        },
      },
    },
  },
}
