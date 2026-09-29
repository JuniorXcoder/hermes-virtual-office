import { localOriginAllowed } from '../src/lib/local-guard'

const valid = [
  ['localhost:3000', 'http://localhost:3000'],
  ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ['[::1]:3000', 'http://[::1]:3000'],
] as const
for (const [host, origin] of valid) {
  if (!localOriginAllowed(host, origin)) throw new Error(`rejected ${origin}`)
}
const invalid = [
  ['localhost:3000', 'http://evil.test'],
  ['office.example:3000', 'http://office.example:3000'],
  ['localhost:3000', 'https://localhost:3000'],
  ['localhost:3000', null],
  [null, 'http://localhost:3000'],
] as const
for (const [host, origin] of invalid) {
  if (localOriginAllowed(host, origin)) throw new Error(`accepted ${origin}`)
}
console.log(`${valid.length + invalid.length}/${valid.length + invalid.length} local write-guard checks passed`)
