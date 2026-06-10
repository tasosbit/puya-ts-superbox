import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { SuperboxArgs, SuperboxFactory } from '../artifacts/superbox/SuperboxClient'
import { getSuperboxData, getSuperboxMeta, getSuperboxValue, getSuperboxValueLocation } from './clientish'

describe('Superbox contract', () => {
  const localnet = algorandFixture()
  const name = 'toast'
  const maxBoxSize = 128n
  const valueSize = 2n
  const valueSchema = 'uint16'

  beforeAll(() => {
    Config.configure({
      debug: true,
      // traceAll: true,
    })
    registerDebugEventHandlers()
  })
  beforeEach(localnet.newScope)

  const deploy = async (
    account: Address,
    overrides?: Partial<SuperboxArgs['obj']['superboxCreate(string,uint64,uint64,string)void']>,
  ) => {
    const factory = localnet.algorand.client.getTypedAppFactory(SuperboxFactory, {
      defaultSender: account,
    })

    const [{ appClient: client }, funder] = await Promise.all([
      factory.deploy({
        onUpdate: 'append',
        onSchemaBreak: 'append',
      }),
      localnet.context.generateAccount({ initialFunds: (100.2).algos() }),
    ])

    const args = {
      name,
      maxBoxSize,
      valueSize,
      valueSchema,
      ...overrides,
    }

    await client
      .newGroup()
      .addTransaction(
        await client.algorand.createTransaction.payment({
          sender: funder,
          receiver: client.appAddress,
          amount: (100).algo(),
        }),
      )
      .superboxCreate({ args })
      .send()

    return { client }
  }

  test('appends simple', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const data = makeData(16)
    const { return: retVal } = await client.send.superboxAppend({ args: { name, data } })
    const writtenData = await getSuperboxData(client, name)

    expect(retVal).toBe(16n)
    expect(writtenData).toEqual(data)
  })

  test('appends twice', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const data = makeData(32)
    await client.send.superboxAppend({ args: { name, data: data.slice(0, 20) } })

    const { return: retVal } = await client.send.superboxAppend({ args: { name, data: data.slice(20) } })
    expect(retVal).toBe(32n)
    expect(await getSuperboxData(client, name)).toEqual(data)
  })

  test('appends over multiple boxes', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const data = makeData(352)
    await client.send.superboxAppend({ args: { name, data: data.slice(0, 64) } })
    const { return: retVal } = await client.send.superboxAppend({ args: { name, data: data.slice(64) } })

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(retVal).toBe(BigInt(data.length))
    expect(meta).toEqual({
      boxByteLengths: [128, 128, 96],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)
  })

  test('append respects value boundaries', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 20n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    const data = makeData(24)
    await client.send.superboxAppend({ args: { name, data } })

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(meta).toEqual({
      boxByteLengths: [16, 8],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)
  })

  test('get location by value index', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    const data = makeData(8 * 9) // [32, 32, 8]

    await client.send.superboxAppend({ args: { name, data } })

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(meta).toEqual({
      boxByteLengths: [32, 32, 8],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)

    const positions = await Promise.all(new Array(9).fill(1).map((_, i) => getSuperboxValueLocation(client, name, i)))

    expect(positions[0]).toEqual([0n, valueSize * 0n])
    expect(positions[1]).toEqual([0n, valueSize * 1n])
    expect(positions[2]).toEqual([0n, valueSize * 2n])
    expect(positions[3]).toEqual([0n, valueSize * 3n])

    expect(positions[4]).toEqual([1n, valueSize * 0n])
    expect(positions[5]).toEqual([1n, valueSize * 1n])
    expect(positions[6]).toEqual([1n, valueSize * 2n])
    expect(positions[7]).toEqual([1n, valueSize * 3n])

    expect(positions[8]).toEqual([2n, valueSize * 0n])

    await expect(getSuperboxValue(client, name, 9)).rejects.toThrow(/ERR:OOB/)
  })

  test('get data by value index', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    const valueCount = 20
    const values = new Array(valueCount).fill(1).map((_) => makeData(8))
    const data = Buffer.concat(values)

    // send them one by one intentionally
    for (const data of values) {
      await client.send.superboxAppend({ args: { name, data } })
    }

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(meta).toEqual({
      boxByteLengths: [32, 32, 32, 32, 32],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)

    for (let i = 0; i < valueCount; i++) {
      const remoteValue = await getSuperboxValue(client, name, i)
      expect(remoteValue).toEqual(values[i])
    }

    await expect(getSuperboxValue(client, name, valueCount)).rejects.toThrow(/ERR:OOB/)
  })

  test('Delete one value by index', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    let valueCount = 20
    let values = new Array(valueCount).fill(1).map((_) => makeData(8))
    let data = Buffer.concat(values)

    await client.newGroup().noop({ args: {} }).superboxAppend({ args: { name, data } }).send()
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 6 } })

    values.splice(6, 1)
    valueCount -= 1
    data = Buffer.concat(values)

    await expect(client.send.superboxDeleteIndex({ args: { name, valueIndex: valueCount } })).rejects.toThrow(/ERR:OOB/)

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(meta).toEqual({
      boxByteLengths: [32, 24, 32, 32, 32],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)

    for (let i = 0; i < valueCount; i++) {
      const remoteValue = await getSuperboxValue(client, name, i)
      expect(remoteValue).toEqual(values[i])
    }
  })

  test('Delete all values in box by index', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    let valueCount = 20
    let values = new Array(valueCount).fill(1).map((_) => makeData(8))
    let data = Buffer.concat(values)

    await client.newGroup().noop({ args: {} }).superboxAppend({ args: { name, data } }).send()
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 7 } })
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 6 } })
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 5 } })
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 4 } })

    values.splice(4, 4)
    valueCount -= 4
    data = Buffer.concat(values)

    await expect(client.send.superboxDeleteIndex({ args: { name, valueIndex: valueCount } })).rejects.toThrow(/ERR:OOB/)

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(meta).toEqual({
      boxByteLengths: [32, 0, 32, 32, 32],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)

    for (let i = 0; i < valueCount; i++) {
      const remoteValue = await getSuperboxValue(client, name, i)
      expect(remoteValue).toEqual(values[i])
    }
  })

  test('Delete box', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    let valueCount = 20
    let values = new Array(valueCount).fill(1).map((_) => makeData(8))
    let data = Buffer.concat(values)

    await client.newGroup().noop({ args: {} }).superboxAppend({ args: { name, data } }).send()
    await client.send.superboxDeleteBox({ args: { name, boxNum: 1 } })

    values.splice(4, 4)
    valueCount -= 4
    data = Buffer.concat(values)

    await expect(client.send.superboxDeleteBox({ args: { name, boxNum: 1 } })).rejects.toThrow(/ERR:DLTD/)
    await expect(client.send.superboxDeleteBox({ args: { name, boxNum: 5 } })).rejects.toThrow(/ERR:OOB/)

    const meta = await getSuperboxMeta(client, name)
    const writtenData = await getSuperboxData(client, name)

    expect(meta).toEqual({
      boxByteLengths: [32, 0, 32, 32, 32],
      totalByteLength: BigInt(data.length),
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)

    for (let i = 0; i < valueCount; i++) {
      const remoteValue = await getSuperboxValue(client, name, i)
      expect(remoteValue).toEqual(values[i])
    }
  })

  test('Delete Superbox after deleting one box by indices', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    let valueCount = 20
    let values = new Array(valueCount).fill(1).map((_) => makeData(8))
    let data = Buffer.concat(values)

    await client.newGroup().noop({ args: {} }).superboxAppend({ args: { name, data } }).send()
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 7 } })
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 6 } })
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 5 } })
    await client.send.superboxDeleteIndex({ args: { name, valueIndex: 4 } })

    await client.send.superboxDeleteBox({ args: { name, boxNum: 4 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 3 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 2 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 0 } })

    await client.send.superboxDeleteSuperbox({ args: { name } })

    await expect(client.send.superboxDeleteSuperbox({ args: { name } })).rejects.toThrow(/ERR:NEXIST/)

    const boxNames = await client.algorand.app.getBoxNames(client.appId)
    expect(boxNames).toEqual([])
  })

  test('Delete Superbox', async () => {
    const { testAccount } = localnet.context
    const valueSize = 8n
    const maxBoxSize = 38n
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    let valueCount = 20
    let values = new Array(valueCount).fill(1).map((_) => makeData(8))
    let data = Buffer.concat(values)

    await client.newGroup().noop({ args: {} }).superboxAppend({ args: { name, data } }).send()
    await client.send.superboxDeleteBox({ args: { name, boxNum: 4 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 3 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 2 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 1 } })
    await client.send.superboxDeleteBox({ args: { name, boxNum: 0 } })
    await client.send.superboxDeleteSuperbox({ args: { name } })

    await expect(client.send.superboxDeleteSuperbox({ args: { name } })).rejects.toThrow(/ERR:NEXIST/)

    const boxNames = await client.algorand.app.getBoxNames(client.appId)
    expect(boxNames).toEqual([])
  })

  test('sbExists works (exists true)', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    const { return: retVal } = await client.send.superboxExists({ args: { name } })
    expect(retVal).toBe(true)
  })

  test('sbExists works (exists false)', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount, { valueSize, maxBoxSize })

    const { return: retVal } = await client.send.superboxExists({ args: { name: 'a' + name } })
    expect(retVal).toBe(false)
  })

  // Regression: data box names must be prefix-free. Committee storage names its
  // superbox `S` + numericId (raw decimal, no delimiter). With the old naming
  // (name + itoa(page)), two superboxes whose numeric ids are decimal prefixes of
  // each other could resolve to the same data box key, silently sharing storage:
  //   S1  page 10 -> "S110"
  //   S11 page  0 -> "S110"   (collision!)
  // The `_` delimiter (S1_10 vs S11_0) makes the key space prefix-free.
  test('prefix-colliding superbox names do not share data boxes', async () => {
    const { testAccount } = localnet.context
    const small = { maxBoxSize: 8n, valueSize: 2n, valueSchema: 'uint16' }

    // Two superboxes in the same app whose names are decimal prefixes (numIds 1 & 11)
    const { client } = await deploy(testAccount, { name: 'S1', ...small })
    await client.send.superboxCreate({ args: { name: 'S11', ...small } })

    // 8 bytes per box (4 uint16 values). Fill S1 across 11 boxes (pages 0..10) so
    // it reaches page 10. Distinct, non-zero bytes so any cross-write is visible.
    const s1Data = Buffer.from(new Array(88).fill(0).map((_, i) => (i + 1) & 0xff))
    const s11Data = Buffer.alloc(8, 0xaa)

    // Append one box (8 bytes) at a time to stay within per-call opcode/box-ref
    // limits, filling S1 boxes 0..10.
    for (let page = 0; page < 11; page++) {
      await client.send.superboxAppend({ args: { name: 'S1', data: s1Data.subarray(page * 8, page * 8 + 8) } })
    }
    // S11 page 0 -> "S110", which collides with S1 page 10 under the old naming.
    await client.send.superboxAppend({ args: { name: 'S11', data: s11Data } })

    // Each superbox's metadata must be independent and intact.
    const s1Meta = (await getSuperboxMeta(client, 'S1'))!
    const s11Meta = (await getSuperboxMeta(client, 'S11'))!
    expect(s1Meta.boxByteLengths).toEqual(new Array(11).fill(8))
    expect(s1Meta.totalByteLength).toBe(88n)
    expect(s11Meta.boxByteLengths).toEqual([8])
    expect(s11Meta.totalByteLength).toBe(8n)

    // The previously-colliding keys must exist as two distinct boxes on-chain.
    const boxNames = (await client.algorand.app.getBoxNames(client.appId)).map((b) => b.name)
    expect(boxNames).toContain('S1_10')
    expect(boxNames).toContain('S11_0')

    // Every value reads back exactly as written for both superboxes.
    for (let i = 0; i < 44; i++) {
      expect(await getSuperboxValue(client, 'S1', i)).toEqual(Buffer.from(s1Data.subarray(i * 2, i * 2 + 2)))
    }
    for (let i = 0; i < 4; i++) {
      expect(await getSuperboxValue(client, 'S11', i)).toEqual(Buffer.from(s11Data.subarray(i * 2, i * 2 + 2)))
    }

    // Bulk reads confirm neither superbox's data was disturbed by the other.
    expect(await getSuperboxData(client, 'S1')).toEqual(s1Data)
    expect(await getSuperboxData(client, 'S11')).toEqual(s11Data)
  })
})

export function makeData(len: number): Buffer {
  const array = new Uint8Array(len)
  crypto.getRandomValues(array)
  return Buffer.from(array)
}
