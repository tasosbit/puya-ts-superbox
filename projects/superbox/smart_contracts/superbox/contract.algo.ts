import {
  assert,
  Box,
  BoxMap,
  BoxRef,
  bytes,
  Bytes,
  Contract,
  err,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { abimethod, DynamicArray, Str, UintN16 } from '@algorandfoundation/algorand-typescript/arc4'
import { au16, au64, BoxNum, ByteOffset, SuperboxMeta } from './types.algo'
import { itoa } from './util.algo'

function sbDataBoxName(name: string, num: uint64) {
  return Bytes(name).concat(Bytes(itoa(num)))
}

function sbDataBoxRef(name: string, num: uint64) {
  return BoxRef({ key: sbDataBoxName(name, num) })
}

function sbMetaBox(name: string): Box<SuperboxMeta> {
  const metaBoxMap = BoxMap<string, SuperboxMeta>({ keyPrefix: '' })
  return metaBoxMap(name + '_m')
}

function sbMetaBoxValue(name: string): SuperboxMeta {
  const metaBox = sbMetaBox(name)
  assert(metaBox.exists, 'ERR:SBNEXIST')
  return metaBox.value
}

function sbCreate(name: string, maxBoxSize: uint64, valueSize: uint64, valueSchema: string) {
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

function sbAppend(name: string, data: bytes): uint64 {
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

function sbGetLocation(name: string, valueIndex: uint64): [BoxNum, ByteOffset] {
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

function sbGetData(name: string, valueIndex: uint64): bytes {
  const [boxNum, byteOffset] = sbGetLocation(name, valueIndex)
  const box = sbDataBoxRef(name, boxNum)
  const valueSize = sbMetaBoxValue(name).valueSize.native
  return box.value.slice(byteOffset, byteOffset + valueSize)
}

export class Superbox extends Contract {
  /**
   * Create superbox metadata
   * @param name Superbox name/prefix
   * @param maxBoxSize max individual box size
   * @param valueSize value size
   * @param valueSchema string describing the value, e.g. uint32
   */
  public superboxCreate(name: string, maxBoxSize: uint64, valueSize: uint64, valueSchema: string) {
    sbCreate(name, maxBoxSize, valueSize, valueSchema)
  }

  /**
   * Append to superbox.
   * @param name superbox name/prefix
   * @param data data to add
   * @returns superbox total bytes used
   */
  public superboxAppend(name: string, data: bytes): uint64 {
    return sbAppend(name, data)
  }

  public noop() {}

  @abimethod({ readonly: true })
  public superboxGetMeta(name: string): SuperboxMeta {
    return sbMetaBox(name).value
  }

  @abimethod({ readonly: true })
  public superboxGetLocation(name: string, valueIndex: uint64): [BoxNum, ByteOffset] {
    return sbGetLocation(name, valueIndex)
  }

  @abimethod({ readonly: true })
  public superboxGetValue(name: string, valueIndex: uint64): bytes {
    return sbGetData(name, valueIndex)
  }
}
