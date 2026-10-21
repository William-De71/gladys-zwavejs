import type { ZwaveNode } from '../types/zwave.ts'

/**
 * The node `deviceId`: `<manufacturerId>-<productId>-<productType>`.
 *
 * Only the `getNodes` answer carries it. The node that comes with a node event
 * (`node_value_updated` included) is a shorter serialization without it — but
 * with the three ids it is built from, so it is rebuilt the way zwave-js-ui
 * does. Without that, a report would miss every per-product rule, and the
 * Flush Pilot level would be read as a dimmer one.
 */
export function deviceIdOf(node: ZwaveNode): string | undefined {
  if (typeof node.deviceId === 'string' && node.deviceId !== '') {
    return node.deviceId
  }
  const { manufacturerId, productId, productType } = node
  if (
    typeof manufacturerId !== 'number' ||
    typeof productId !== 'number' ||
    typeof productType !== 'number'
  ) {
    return undefined
  }
  return `${manufacturerId}-${productId}-${productType}`
}
