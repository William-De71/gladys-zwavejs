import type { ZwaveNode } from '../types/zwave.ts'

/**
 * Qubino Flush Pilot, every version zwave-js knows (`0x0159 0x0004-…`): they
 * share the same configuration and the same level ranges. Shared by the
 * command classes that need a variant for it.
 */
export const QUBINO_FLUSH_PILOT = [
  '345-1-4', // ZMNHJA
  '345-81-4', // ZMNHJD
  '345-82-4', // ZMNHUD, DIN rail
] as const

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

/** The same variant for each of several products, as a `byProduct` map. */
export function forProducts<T>(products: readonly string[], variant: T): Record<string, T> {
  return Object.fromEntries(products.map((product) => [product, variant]))
}
