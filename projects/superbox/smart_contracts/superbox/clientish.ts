import { SuperboxClient } from '../artifacts/superbox/SuperboxClient'

export async function getSuperboxMeta(client: SuperboxClient, name: string) {
  const { return: meta } = await client.send.superboxGetMeta({ args: { name } })
  return meta
}

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
