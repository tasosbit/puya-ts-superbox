import { assert, Box, Bytes, bytes, clone, err, uint64 } from '@algorandfoundation/algorand-typescript'
import { DynamicArray, Str, Uint16 } from '@algorandfoundation/algorand-typescript/arc4'
import { au16, au64, BoxNum, ByteOffset, SuperboxMeta } from './types.algo'
import { sbDataBoxRef, sbMetaBox, sbMetaBoxValue } from './utils.algo'

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
    boxByteLengths: new DynamicArray<Uint16>(),
    valueSize: au64(valueSize),
    valueSchema: new Str(valueSchema),
  })
  const metaBox = sbMetaBox(name)
  assert(!metaBox.exists, 'ERR:SBEXISTS')
  metaBox.value = clone(meta)
}

/**
 * Append data to superbox
 * @param name Superbox name/prefix
 * @param data Data to append. Must be multiple of valueSize.
 * @returns Superbox total data length
 */
export function sbAppend(name: string, data: bytes): uint64 {
  const meta = sbMetaBoxValue(name)
  const maxBoxSize = meta.maxBoxSize.asUint64()
  const valueSize = meta.valueSize.asUint64()

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
      meta.boxByteLengths[currentBoxNum] = au16(meta.boxByteLengths[currentBoxNum].asUint64() + chunkWritten)
    }

    dataWritten += chunkWritten
    currentBoxNum++
  }
  meta.totalByteLength = au64(meta.totalByteLength.asUint64() + dataWritten)

  const metaBox = sbMetaBox(name)
  metaBox.delete()
  metaBox.value = clone(meta)

  return meta.totalByteLength.asUint64()
}

/**
 * Internal - Append data to single box
 * @param box BoxRef of box to write to
 * @param data Data to write
 * @param maxBoxSize Maximum box size to use
 * @param valueSize Size of values, e.g. 4 for uint32
 * @returns Length of data written
 */
function appendBox(box: Box<bytes>, data: bytes, maxBoxSize: uint64, valueSize: uint64): uint64 {
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
 * Get superbox metadata
 * @param name Superbox name/prefix
 * @returns Superbox metadata
 */
export function sbGetMeta(name: string): SuperboxMeta {
  const meta = sbMetaBox(name)
  assert(meta.exists, 'ERR:NOMETA')
  return meta.value
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

  const valueSize = meta.value.valueSize.asUint64()
  const prevBoxByteLength = meta.value.boxByteLengths[boxNum].asUint64()

  if (prevBoxByteLength === valueSize) {
    // box empty - delete
    dataBox.delete()
    // adjust metadata
    meta.value.boxByteLengths[boxNum] = au16(0)
  } else {
    // splice value out of data box. Leaves empty bytes of size valueSize at end of box
    dataBox.splice(byteOffset, valueSize, Bytes``)
    // resize box to trim the zero values
    dataBox.resize(prevBoxByteLength - valueSize)
    // adjust metadata
    meta.value.boxByteLengths[boxNum] = au16(prevBoxByteLength - valueSize)
  }

  // adjust total metadata
  meta.value.totalByteLength = au64(meta.value.totalByteLength.asUint64() - valueSize)

  return meta.value.totalByteLength.asUint64()
}

/**
 * Delete box by box index/number
 * @param name Superbox name/prefix
 * @param boxNum Box number to delete
 * @returns Superbox total data length
 */
export function sbDeleteBox(name: string, boxNum: uint64): uint64 {
  const meta = sbMetaBox(name)
  const metaValue = clone(meta.value)
  const dataBox = sbDataBoxRef(name, boxNum)

  assert(boxNum < metaValue.boxByteLengths.length, 'ERR:OOB')
  assert(dataBox.exists, 'ERR:DLTD')

  // adjust metadata
  metaValue.totalByteLength = au64(metaValue.totalByteLength.asUint64() - metaValue.boxByteLengths[boxNum].asUint64())
  metaValue.boxByteLengths[boxNum] = au16(0)
  meta.value = clone(metaValue)

  // delete box
  dataBox.delete()

  return metaValue.totalByteLength.asUint64()
}

/**
 * Delete box by box index/number
 * @param name Superbox name/prefix
 */
export function sbDeleteSuperbox(name: string) {
  // TODO emptying out a box by sbDeleteIndex leaves the data box itself intact.
  // This would allow deleting a superbox while there is still a databox in the contract
  // Probably OK to delete box at sbDeleteIndex, but think & fix
  const metaBox = sbMetaBox(name)

  assert(metaBox.exists, 'ERR:NEXIST')
  assert(metaBox.value.totalByteLength.asUint64() === 0, 'ERR:NEMPTY')

  metaBox.delete()
}

/**
 * Get location (box number, byte offset) for a value by index
 * @param name Superbox name/prefix
 * @param valueIndex Index of value to get
 * @returns [uint64, uint64] [Data box index, Value offset in bytes]
 */
export function sbGetLocation(name: string, valueIndex: uint64): [BoxNum, ByteOffset] {
  const meta = sbMetaBoxValue(name)
  const valueSize = meta.valueSize.asUint64()
  const totalBoxes = meta.boxByteLengths.length

  // target
  let byteIndex: uint64 = valueIndex * valueSize

  // check out of bounds. must have space for byteIndex(start) plus the value
  assert(byteIndex + valueSize <= meta.totalByteLength.asUint64(), 'ERR:OOB')

  let elapsedBytes: uint64 = 0
  for (let i: uint64 = 0; i < totalBoxes; i++) {
    const boxSize = meta.boxByteLengths[i].asUint64()
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
  const valueSize = sbMetaBoxValue(name).valueSize.asUint64()
  return box.value.slice(byteOffset, byteOffset + valueSize)
}
