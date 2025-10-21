import { arc4, uint64 } from '@algorandfoundation/algorand-typescript'
import { DynamicArray, Str, Uint16, Uint64 } from '@algorandfoundation/algorand-typescript/arc4'

/**
 * Metadata struct. Stored per superbox
 */
export class SuperboxMeta extends arc4.Struct<{
  /**
   * Size of individual data boxes backing superbox
   */
  boxByteLengths: DynamicArray<Uint16>
  /**
   * Total data in superbox
   */
  totalByteLength: Uint64
  /**
   * Max individual box size to use
   */
  maxBoxSize: Uint64
  /**
   * Byte width of individual value. Used to enforce box/value boundaries & calculate offsets when fetching values by index
   */
  valueSize: Uint64
  /**
   * Informational. Schema of value, e.g. `(uint16,uint16)` for Tuple<uint16, uint16>
   */
  valueSchema: Str
}> {}

export function au16(num: uint64) {
  return new Uint16(num)
}

export function au64(num: uint64) {
  return new Uint64(num)
}

export type BoxNum = uint64
export type ByteOffset = uint64
