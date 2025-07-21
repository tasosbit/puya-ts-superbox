import { assert, Box, BoxMap, BoxRef, bytes, Bytes, Contract, uint64 } from '@algorandfoundation/algorand-typescript'
import { abimethod, DynamicArray, Str, UintN16 } from '@algorandfoundation/algorand-typescript/arc4'
import { au16, au32, SuperboxMeta } from './types.algo'
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
    // evidently, puya ts dynamicarrays must be grown with push
    // `arr[newIndex] = newValue` fails
    if (meta.boxByteLengths.length === currentBoxNum) {
      meta.boxByteLengths.push(au16(0))
    }

    const dataBox = sbDataBoxRef(name, currentBoxNum)
    const chunkWritten = appendBox(dataBox, data.slice(dataWritten, dataWritten + maxBoxSize), maxBoxSize, valueSize)

    meta.totalByteLength = au32(meta.totalByteLength.native + chunkWritten)
    meta.boxByteLengths[currentBoxNum] = au16(meta.boxByteLengths[currentBoxNum].native + chunkWritten)

    dataWritten += chunkWritten
    currentBoxNum++
  }

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
    box.value = data.slice(0, capacity)
    return capacity
  }
}

function sbCreate(name: string, maxBoxSize: uint64, valueSize: uint64, valueSchema: string) {
  const meta = new SuperboxMeta({
    totalByteLength: au32(0),
    maxBoxSize: au16(maxBoxSize),
    boxByteLengths: new DynamicArray<UintN16>(),
    valueSize: au16(valueSize),
    valueSchema: new Str(valueSchema),
  })
  const metaBox = sbMetaBox(name)
  assert(!metaBox.exists, 'ERR:SBEXISTS')
  metaBox.value = meta.copy()
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

  @abimethod({ readonly: true })
  public superboxGetMeta(name: string): SuperboxMeta {
    return sbMetaBox(name).value
  }
}
