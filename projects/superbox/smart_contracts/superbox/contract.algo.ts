import { bytes, Contract, uint64 } from '@algorandfoundation/algorand-typescript'
import { abimethod } from '@algorandfoundation/algorand-typescript/arc4'
import {
  sbAppend,
  sbCreate,
  sbDeleteBox,
  sbDeleteIndex,
  sbDeleteSuperbox,
  sbGetData,
  sbGetLocation,
} from './lib/superbox.algo'
import { BoxNum, ByteOffset, SuperboxMeta } from './lib/types.algo'
import { sbMetaBox } from './lib/utils.algo'

export class Superbox extends Contract {
  public superboxCreate(name: string, maxBoxSize: uint64, valueSize: uint64, valueSchema: string) {
    sbCreate(name, maxBoxSize, valueSize, valueSchema)
  }

  public superboxAppend(name: string, data: bytes): uint64 {
    return sbAppend(name, data)
  }

  public superboxDeleteIndex(name: string, valueIndex: uint64): uint64 {
    return sbDeleteIndex(name, valueIndex)
  }

  public superboxDeleteBox(name: string, boxNum: uint64): uint64 {
    return sbDeleteBox(name, boxNum)
  }

  public superboxDeleteSuperbox(name: string) {
    sbDeleteSuperbox(name)
  }

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

  public noop() {}
}
