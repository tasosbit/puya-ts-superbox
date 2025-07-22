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
})

export function makeData(len: number): Buffer {
  const array = new Uint8Array(len)
  crypto.getRandomValues(array)
  return Buffer.from(array)
}
