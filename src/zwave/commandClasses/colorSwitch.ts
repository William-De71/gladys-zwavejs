import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import type { CommandClassModule } from './types.ts'
import { writeValue } from './types.ts'

/** Largest RGB integer, `ffffff`. */
const MAX_RGB = 0xffffff

/**
 * zwave-js formats the colour as `rrggbb`, and accepts `#rrggbb` on writes.
 * Anything else — an empty string before the first report — publishes nothing.
 */
function hexToRgb(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null
  }
  const match = /^#?([0-9a-f]{6})$/i.exec(raw.trim())
  return match ? Number.parseInt(match[1] as string, 16) : null
}

/**
 * Color Switch (0x33) — RGB(W) bulbs and LED strips.
 *
 * Only `hexColor` is exposed. zwave-js derives it from the red, green and blue
 * channels, and only creates it on devices that support all three, so its
 * presence is the test for "this is an RGB light". The individual channels
 * (`currentColor` / `targetColor`, warm and cold white included) stay
 * unmapped: Gladys has one colour feature, an RGB integer, and exposing the
 * channels next to it would give the user five sliders fighting over the same
 * LEDs.
 *
 * The brightness is not here: these devices also speak Multilevel Switch,
 * whose dimmer features already carry it.
 */
export const colorSwitch: CommandClassModule = {
  id: 51,
  name: 'color_switch',
  properties: {
    hexcolor: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.LIGHT,
              type: DEVICE_FEATURE_TYPES.LIGHT.COLOR,
              min: 0,
              max: MAX_RGB,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
        ],
        fromZwave: [{ convert: hexToRgb }],
        toZwave: {
          '': (value) => {
            if (!Number.isInteger(value) || value < 0 || value > MAX_RGB) {
              throw new Error(`Invalid RGB color: ${value}`)
            }
            return writeValue('hexColor', value.toString(16).padStart(6, '0'))
          },
        },
      },
    },
  },
}
