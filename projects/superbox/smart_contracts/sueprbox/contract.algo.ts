import { Contract } from '@algorandfoundation/algorand-typescript'

export class Sueprbox extends Contract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
