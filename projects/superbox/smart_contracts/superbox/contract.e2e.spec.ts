import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { SuperboxArgs, SuperboxFactory } from '../artifacts/superbox/SuperboxClient'
import { getSuperboxData, getSuperboxMeta } from './clientish'

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
      totalByteLength: 24n,
      maxBoxSize,
      valueSchema,
      valueSize,
    })
    expect(writtenData).toEqual(data)
  })
})

export function makeData(len: number): Buffer {
  const array = new Uint8Array(len)
  crypto.getRandomValues(array)
  return Buffer.from(array)
}
