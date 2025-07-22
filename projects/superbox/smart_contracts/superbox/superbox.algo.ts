import { assert, BoxRef, Bytes, bytes, err, uint64 } from '@algorandfoundation/algorand-typescript'
import { DynamicArray, Str, UintN16 } from '@algorandfoundation/algorand-typescript/arc4'
import { sbDataBoxRef, sbMetaBox, sbMetaBoxValue } from './superalgo-utils.algo'
import { au16, au64, BoxNum, ByteOffset, SuperboxMeta } from './types.algo'

/**
 * Create superbox metadata
 * @param name Superbox name/prefix
 * @param maxBoxSize Max individual box size
 * @param valueSize Value size
 * @param valueSchema String describing the value, e.g. uint32
 */
export function sbCreate(name: string, maxBoxSize: uint64, valueSize: uint64, valueSchema: string) {
  const meta = new SuperboxMeta({
    totalByteLength: au64(0),
    maxBoxSize: au64(maxBoxSize),
    boxByteLengths: new DynamicArray<UintN16>(),
    valueSize: au64(valueSize),
    valueSchema: new Str(valueSchema),
  })
  const metaBox = sbMetaBox(name)
  assert(!metaBox.exists, 'ERR:SBEXISTS')
  metaBox.value = meta.copy()
}

/**
 * Append data to superbox
 * @param name Superbox name/prefix
 * @param data Data to append. Must be multiple of valueSize.
 * @returns Superbox total data length
 */
export function sbAppend(name: string, data: bytes): uint64 {
  const meta = sbMetaBoxValue(name)
  const maxBoxSize = meta.maxBoxSize.native
  const valueSize = meta.valueSize.native

  // data can be multiple concatenated values for all we care, but it must be the right size
  assert(data.length % valueSize === 0, 'ERR:DATALEN')

  let currentBoxNum: uint64 = meta.boxByteLengths.length === 0 ? 0 : meta.boxByteLengths.length - 1
  // tracks bytes written
  let dataWritten: uint64 = 0

  while (dataWritten < data.length) {
    const dataBox = sbDataBoxRef(name, currentBoxNum)
    const chunkWritten = appendBox(dataBox, data.slice(dataWritten, dataWritten + maxBoxSize), maxBoxSize, valueSize)

    if (meta.boxByteLengths.length === currentBoxNum) {
      // new box
      meta.boxByteLengths.push(au16(chunkWritten))
    } else {
      // existing box
      meta.boxByteLengths[currentBoxNum] = au16(meta.boxByteLengths[currentBoxNum].native + chunkWritten)
    }

    dataWritten += chunkWritten
    currentBoxNum++
  }
  meta.totalByteLength = au64(meta.totalByteLength.native + dataWritten)

  const metaBox = sbMetaBox(name)
  metaBox.delete()
  metaBox.value = meta.copy()

  return meta.totalByteLength.native
}

/**
 * Internal - Append data to single box
 * @param box BoxRef of box to write to
 * @param data Data to write
 * @param maxBoxSize Maximum box size to use
 * @param valueSize Size of values, e.g. 4 for uint32
 * @returns Length of data written
 */
function appendBox(box: BoxRef, data: bytes, maxBoxSize: uint64, valueSize: uint64): uint64 {
  if (box.exists) {
    // existing box
    let capacity: uint64 = maxBoxSize - box.length
    // box won't fit a single value: do not write anything
    if (capacity < valueSize) return 0
    // we only want whole values - round down capacity to be a multiple of valueSize
    if (capacity % valueSize !== 0) {
      capacity -= capacity % valueSize
    }
    if (data.length > capacity) {
      // data does not fit in box - write partial
      const originalBoxLength = box.length
      box.resize(box.length + capacity)
      box.replace(originalBoxLength, data.slice(0, capacity))
      return capacity
    } else {
      // data fits in box
      const originalBoxLength = box.length
      box.resize(box.length + data.length)
      box.replace(originalBoxLength, data)
      return data.length
    }
  } else {
    // else: new box
    let capacity: uint64 = maxBoxSize
    // we only want whole values - round down capacity to be a multiple of valueSize
    if (capacity % valueSize !== 0) {
      capacity -= capacity % valueSize
    }
    const dataToWrite = data.slice(0, capacity)
    box.value = dataToWrite
    return dataToWrite.length
  }
}

/**
 * Delete value by index
 * @param name Superbox name/prefix
 * @param valueIndex Index of value to get
 * @returns Superbox total data length
 */
export function sbDeleteIndex(name: string, valueIndex: uint64): uint64 {
  const meta = sbMetaBox(name)
  const [boxNum, byteOffset] = sbGetLocation(name, valueIndex)
  const dataBox = sbDataBoxRef(name, boxNum)

  const valueSize = meta.value.valueSize.native
  const prevBoxByteLength = meta.value.boxByteLengths[boxNum].native

  // splice value out of data box. Leaves empty bytes of size valueSize at end of box
  dataBox.splice(byteOffset, valueSize, Bytes``)
  // resize box to trim the zero values
  dataBox.resize(prevBoxByteLength - valueSize)

  // adjust metadata
  meta.value.boxByteLengths[boxNum] = au16(prevBoxByteLength - valueSize)
  meta.value.totalByteLength = au64(meta.value.totalByteLength.native - valueSize)

  return meta.value.totalByteLength.native
}

/**
 * Get location (box number, byte offset) for a value by index
 * @param name Superbox name/prefix
 * @param valueIndex Index of value to get
 * @returns [uint64, uint64] [Data box index, Value offset in bytes]
 */
export function sbGetLocation(name: string, valueIndex: uint64): [BoxNum, ByteOffset] {
  const meta = sbMetaBoxValue(name)
  const valueSize = meta.valueSize.native
  const totalBoxes = meta.boxByteLengths.length

  // target
  let byteIndex: uint64 = valueIndex * valueSize

  // check out of bounds. must have space for byteIndex(start) plus the value
  assert(byteIndex + valueSize <= meta.totalByteLength.native, 'ERR:OOB')

  let elapsedBytes: uint64 = 0
  for (let i: uint64 = 0; i < totalBoxes; i++) {
    const boxSize = meta.boxByteLengths[i].native
    if (boxSize + elapsedBytes > byteIndex) {
      // we found the box
      return [i, byteIndex - elapsedBytes]
    } else {
      elapsedBytes += boxSize
    }
  }
  // out of bounds should be caught at the top
  err('never?')
}

/**
 * Get value by index
 * @param name Superbox name/prefix
 * @param valueIndex Index of value to get
 * @returns bytes Value
 */
export function sbGetData(name: string, valueIndex: uint64): bytes {
  const [boxNum, byteOffset] = sbGetLocation(name, valueIndex)
  const box = sbDataBoxRef(name, boxNum)
  const valueSize = sbMetaBoxValue(name).valueSize.native
  return box.value.slice(byteOffset, byteOffset + valueSize)
}
