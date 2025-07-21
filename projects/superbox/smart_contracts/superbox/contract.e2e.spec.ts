import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { SuperboxArgs, SuperboxClient, SuperboxFactory } from '../artifacts/superbox/SuperboxClient'

describe('Superbox contract', () => {
  const localnet = algorandFixture()
  let name = 'toast'

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
      maxBoxSize: 128,
      valueSize: 2,
      valueSchema: 'uint16',
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

  test('appends', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const data = bA(16)
    const { return: length } = await client.send.superboxAppend({ args: { name, data } })

    expect(length).toBe(16n)
    expect(await getSuperboxData(client, name)).toEqual(data)
  })

  test('appends twice', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const data = bA(32)
    await client.send.superboxAppend({ args: { name, data: data.slice(0, 16) } })
    const { return: length } = await client.send.superboxAppend({ args: { name, data: data.slice(16) } })

    expect(length).toBe(32n)
    expect(await getSuperboxData(client, name)).toEqual(data)
  })

  test('appends over multiple boxes', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const data = bA(256)
    await client.send.superboxAppend({ args: { name, data: data.slice(0, 64) } })
    const { return: length } = await client.send.superboxAppend({ args: { name, data: data.slice(64) } })

    expect(length).toBe(256n)
    expect(await getSuperboxData(client, name)).toEqual(data)
  })

  test('append respects value boundaries', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount, { valueSize: 8, maxBoxSize: 20 })

    const data = bA(24)
    await client.send.superboxAppend({ args: { name, data } })

    const { return: meta } = await client.send.superboxGetMeta({ args: { name } })
    expect(meta?.boxByteLengths).toEqual([16, 8])

    const writtenData = await getSuperboxData(client, name)
    expect(writtenData).toEqual(data)
  })
})

export async function getSuperboxBoxNames(client: SuperboxClient, name: string): Promise<string[]> {
  const boxNames = await client.algorand.app.getBoxNames(client.appId)
  return boxNames
    .filter(({ name }) => name.startsWith(name) && !name.endsWith('_m'))
    .map(({ name }) => name)
    .sort((a, b) => (Number(a.slice(name.length)) < Number(b.slice(name.length)) ? -1 : 1))
}

export async function getSuperboxData(client: SuperboxClient, name: string): Promise<Buffer> {
  const boxNames = await getSuperboxBoxNames(client, name)
  const boxValues = await client.algorand.app.getBoxValues(client.appId, boxNames)
  return Buffer.concat(boxValues)
}

export function bA(len: number): Buffer {
  const array = new Uint8Array(len)
  crypto.getRandomValues(array)
  return Buffer.from(array)
}
