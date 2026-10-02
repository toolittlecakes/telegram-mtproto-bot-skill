import type { Writable } from 'node:stream'

export function writeOutput(text: string, stream: Pick<Writable, 'write'> = process.stdout): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, error => error ? reject(error) : resolve())
  })
}
