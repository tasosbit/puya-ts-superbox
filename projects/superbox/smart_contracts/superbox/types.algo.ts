import { arc4, uint64 } from '@algorandfoundation/algorand-typescript'
import { DynamicArray, Str, UintN16, UintN64 } from '@algorandfoundation/algorand-typescript/arc4'

/**
 * Metadata struct. Stored per superbox
 */
export class SuperboxMeta extends arc4.Struct<{
  /**
   * Size of individual boxes backing superbox
   */
  boxByteLengths: DynamicArray<UintN16>
  /**
   * Total data in superbox
   */
  totalByteLength: UintN64
  /**
   * Max individual box size to use
   */
  maxBoxSize: UintN64
  /**
   * Byte width of individual value. Used to enforce box/value boundaries & calculate offsets when fetching values by index
   */
  valueSize: UintN64
  /**
   * Informational. Schema of value, e.g. `(uint16,uint16)` for Tuple<uint16, uint16>
   */
  valueSchema: Str
}> {}

export function au16(num: uint64) {
  return new UintN16(num)
}

export function au64(num: uint64) {
  return new UintN64(num)
}

export type BoxNum = uint64
export type ByteOffset = uint64
