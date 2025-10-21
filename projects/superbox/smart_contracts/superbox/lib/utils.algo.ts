import { assert, Box, BoxMap, bytes, Bytes, uint64 } from '@algorandfoundation/algorand-typescript'
import { SuperboxMeta } from './types.algo'

/**
 * Convert number to ascii representation
 * @param i number as uint64
 * @returns i as ascii string
 */
export function itoa(i: uint64): string {
  const digits = Bytes`0123456789`
  const radix = digits.length
  if (i < radix) {
    return digits.at(i).toString()
  }
  return itoa(i / radix).concat(digits.at(i % radix).toString())
}

/**
 * Get data box key
 * @param name Superbox name/prefix
 * @param num Data box index
 * @returns
 */
export function sbDataBoxName(name: string, num: uint64) {
  return Bytes(name).concat(Bytes(itoa(num)))
}

/**
 * Get BoxRef to data box
 * @param name Superbox name/prefix
 * @param num Data box index
 * @returns Data box BoxRef
 */
export function sbDataBoxRef(name: string, num: uint64): Box<bytes> {
  return Box({ key: sbDataBoxName(name, num) })
}

/**
 * Get Metadata Box for superbox
 * @param name Superbox name/prefix
 * @returns Box
 */
export function sbMetaBox(name: string): Box<SuperboxMeta> {
  const metaBoxMap = BoxMap<string, SuperboxMeta>({ keyPrefix: '' })
  return metaBoxMap(name + '_m')
}

/**
 * Get Metadata value for superbox
 * @param name Superbox name/prefix
 * @returns SuperboxMeta
 */
export function sbMetaBoxValue(name: string): SuperboxMeta {
  const metaBox = sbMetaBox(name)
  assert(metaBox.exists, 'ERR:SBNEXIST')
  return metaBox.value
}
