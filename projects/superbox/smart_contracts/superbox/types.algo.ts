import { arc4, uint64 } from '@algorandfoundation/algorand-typescript'
import { DynamicArray, Str, UintN16, UintN32, UintN64 } from '@algorandfoundation/algorand-typescript/arc4'

export function au16(num: uint64) {
  return new UintN16(num)
}

export function au32(num: uint64) {
  return new UintN32(num)
}

export function au64(num: uint64) {
  return new UintN64(num)
}

export class SuperboxMeta extends arc4.Struct<{
  totalByteLength: UintN64
  boxByteLengths: DynamicArray<UintN16>
  maxBoxSize: UintN64
  valueSize: UintN64
  valueSchema: Str
}> {}
