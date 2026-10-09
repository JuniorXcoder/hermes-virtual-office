/**
 * Write-guard self-test.
 *
 * This guard is the difference between "the buttons work" and "nothing you click
 * does anything", so it is tested against BOTH failure modes:
 *
 *   - too strict: a legitimate origin is refused, so every write 403s from the
 *     browser while reads keep working. That is the bug this file now covers — the
 *     office is opened at a public address, and the guard only knew loopback names.
 *   - too loose: a foreign origin is accepted, which is a CSRF hole.
 */
import { localOriginAllowed } from '../src/lib/local-guard'

let failed = 0
const check = (label: string, got: boolean, want: boolean) => {
  const ok = got === want
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}  -> ${got}${ok ? '' : ` (harap ${want})`}`)
}

// `ALLOWED_ORIGINS` is read at call time, so the public-IP cases only pass when it
// is configured. The test asserts the CONFIGURED behaviour, because an unconfigured
// deploy is exactly the broken state we are guarding against.
process.env.ALLOWED_ORIGINS = '203.0.113.10:3300,office.example.com'

console.log('=== HARUS DITERIMA (kalau tidak, tombol mati) ===')
const valid: [string, string][] = [
  ['localhost:3000', 'http://localhost:3000'],
  ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ['[::1]:3000', 'http://[::1]:3000'],
  // the public address the office is actually opened at — the bug this covers
  ['203.0.113.10:3300', 'http://203.0.113.10:3300'],
  // a configured host on a different port is still that host
  ['203.0.113.10:3300', 'http://203.0.113.10:3300'],
  // a named host from the list, with and without a port
  ['office.example.com:3300', 'http://office.example.com:3300'],
  ['office.example.com', 'http://office.example.com'],
]
for (const [host, origin] of valid) {
  check(`${origin}`, localOriginAllowed(host, origin), true)
}

console.log('\n=== HARUS DITOLAK (kalau tidak, ini lubang CSRF) ===')
const invalid: [string | null, string | null][] = [
  // cross-site: Origin names somebody else
  ['localhost:3000', 'http://evil.test'],
  ['203.0.113.10:3300', 'http://evil.test'],
  // a host we do not trust, even though host and origin agree
  ['office.example:3000', 'http://office.example:3000'],
  ['198.51.100.7:3300', 'http://198.51.100.7:3300'],
  // scheme mismatch
  ['localhost:3000', 'https://localhost:3000'],
  ['203.0.113.10:3300', 'https://203.0.113.10:3300'],
  // missing headers (curl, a cross-site form post, a server-to-server call)
  ['localhost:3000', null],
  [null, 'http://localhost:3000'],
  [null, null],
  // a subdomain is NOT the same host
  ['localhost:3000', 'http://evil.localhost:3000'],
  // a host that merely CONTAINS a trusted one
  ['not203.0.113.10:3300', 'http://not203.0.113.10:3300'],
]
for (const [host, origin] of invalid) {
  check(`${origin ?? '(tanpa origin)'} @ host ${host ?? '(tanpa host)'}`, localOriginAllowed(host, origin), false)
}

console.log('\n=== TANPA ALLOWED_ORIGINS (deploy yang belum dikonfigurasi) ===')
{
  const saved = process.env.ALLOWED_ORIGINS
  delete process.env.ALLOWED_ORIGINS
  // loopback must still work: the server-side tooling and the local dev loop
  check('localhost masih boleh', localOriginAllowed('127.0.0.1:3300', 'http://127.0.0.1:3300'), true)
  // the public address must NOT be silently allowed — an operator has to opt in
  check(
    'IP publik ditolak (harus diisi di ALLOWED_ORIGINS)',
    localOriginAllowed('203.0.113.10:3300', 'http://203.0.113.10:3300'),
    false,
  )
  process.env.ALLOWED_ORIGINS = saved
}

console.log('\n=== RINGKASAN ===')
const total = valid.length + invalid.length + 3
if (failed) {
  console.log(`  ${failed} dari ${total} GAGAL`)
  process.exit(1)
}
console.log(`  ${total}/${total} write-guard checks passed`)
