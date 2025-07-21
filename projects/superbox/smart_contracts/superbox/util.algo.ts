import { Bytes, uint64 } from '@algorandfoundation/algorand-typescript'

export function itoa(i: uint64): string {
  const digits = Bytes`0123456789`
  const radix = digits.length
  if (i < radix) {
    return digits.at(i).toString()
  }
  return itoa(i / radix).concat(digits.at(i % radix).toString())
}
