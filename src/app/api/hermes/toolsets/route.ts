import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const dynamic = 'force-dynamic'

const run = promisify(execFile)
const HERMES_BIN = process.env.HERMES_BIN || 'hermes'

/**
 * Daftar toolset Hermes yang NYATA (dari `hermes tools list --platform cli`).
 *
 * Dipakai form create-agent untuk memilih `advertised_toolsets`: agent card
 * A2A hanya bisa mengumumkan toolset nyata — bukan tag bebas. Tanpa endpoint
 * ini form harus mengarang daftarnya (dan cepat basi).
 */
export async function GET() {
  try {
    const { stdout } = await run(HERMES_BIN, ['tools', 'list', '--platform', 'cli'], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    const toolsets: { name: string; enabled: boolean }[] = []
    for (const line of stdout.split('\n')) {
      const m = /^\s*[✓✗]\s+(enabled|disabled)\s+([a-z0-9_:.-]+)\s/.exec(line)
      if (m) toolsets.push({ name: m[2], enabled: m[1] === 'enabled' })
    }
    return NextResponse.json({ toolsets: toolsets.sort((a, b) => a.name.localeCompare(b.name)) })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'hermes_unavailable', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
