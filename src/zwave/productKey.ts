import type { ZwaveNode } from '../types/zwave.ts'

/**
 * The product a node is, in the shape of the zwave-js-ui `deviceId`:
 * `<manufacturerId>-<productId>-<productType>` — product id BEFORE product
 * type, unlike the zwave-js hex notation (`0x0159 0x0004-0x0051`).
 *
 * `deviceId` only comes with `getNodes`. A node first seen through a node
 * event, on a cold cache, carries the three ids alone, so the key is rebuilt
 * from them the way zwave-js-ui builds it: without that, the per-product rules
 * would depend on which message happened to arrive first.
 */
export function productKey(node: ZwaveNode): string | undefined {
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
