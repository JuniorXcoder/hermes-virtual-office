import { NextResponse } from 'next/server'
import { listModels } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * Model catalogue for the per-task model picker.
 *
 * Sourced from the CLI (`hermes config get custom_providers --json`) rather than
 * from `.env.local`, because that list IS what a worker can actually be spawned
 * with — a hardcoded dropdown would drift from config.yaml. The CLI masks
 * api_key, so nothing secret leaves the server.
 */
export async function GET() {
  try {
    return NextResponse.json({ models: await listModels() })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'hermes_unavailable', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
