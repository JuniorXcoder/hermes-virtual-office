import { NextRequest, NextResponse } from 'next/server'
import {
  getChatSession,
  listChatSessions,
  readChatHistory,
  resetChatSession,
  sendChatMessage,
} from '@/lib/hermes/chat'
import { listAgents, listProfiles, listTasks } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/** A turn can run tools, so give it room. */
export const maxDuration = 300

/**
 * Chat with an agent, with memory.
 *
 * `GET`  — the thread list, and one thread's messages (`?agent=<name>`).
 * `POST` — send a message and get the reply.
 * `DELETE` — forget an agent's thread pointer (history stays in Hermes' store).
 *
 * The conversation memory is Hermes' own per-profile session store; this route only
 * maps an office agent to its session id. See lib/hermes/chat.ts for why.
 */

/** Profiles a chat may run as. `default` is excluded on purpose — see below. */
async function chatProfiles(): Promise<string[]> {
  const all = await listProfiles()
  return all
}

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent')
  try {
    if (!agent) {
      return NextResponse.json({
        sessions: await listChatSessions(),
        /** Who can be chatted with. */
        agents: (await listAgents(await listTasks())).map((a) => a.name),
        profiles: await chatProfiles(),
      })
    }

    const session = await getChatSession(agent)
    if (!session) {
      // No thread yet is a normal state, not an error: the panel shows an empty
      // conversation and the first message creates it.
      return NextResponse.json({ agent, session: null, messages: [] })
    }
    return NextResponse.json({
      agent,
      session,
      messages: await readChatHistory(session.profile, session.id),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'chat_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const agent = typeof body?.agent === 'string' ? body.agent.trim() : ''
  const message = typeof body?.message === 'string' ? body.message : ''
  let profile = typeof body?.profile === 'string' ? body.profile.trim() : ''

  if (!agent) {
    return bad('agent wajib')
  }
  if (!message.trim()) {
    return bad('pesan kosong')
  }

  try {
    // Default the profile to the one already used for this agent's thread, so
    // continuing a conversation does not silently switch personas mid-thread.
    const existing = await getChatSession(agent)
    if (!profile) profile = existing?.profile || (await defaultChatProfile())
    if (!profile) {
      return bad('tidak ada profil untuk chat — buat satu dulu di menu Agent')
    }
    // A profile change mid-thread would mix two memory stores, so it is refused
    // rather than silently starting a second thread under the same name.
    if (existing && existing.profile !== profile) {
      return NextResponse.json(
        {
          error: {
            code: 'profile_locked',
            message:
              `percakapan dengan "${agent}" memakai profil "${existing.profile}". ` +
              `Hapus thread dulu untuk pindah ke "${profile}".`,
            status: 409,
          },
        },
        { status: 409 },
      )
    }

    const known = await listProfiles()
    if (!known.includes(profile)) {
      return bad(`profil "${profile}" tidak ada`)
    }

    const result = await sendChatMessage(agent, profile, message)
    return NextResponse.json({
      success: true,
      session: result.session,
      reply: result.reply,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'chat_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent')
  if (!agent) return bad('agent wajib')
  try {
    await resetChatSession(agent)
    return NextResponse.json({ success: true, agent, reset: true })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'chat_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}

function bad(message: string) {
  return NextResponse.json(
    { error: { code: 'invalid_request', message, status: 400 } },
    { status: 400 },
  )
}

/**
 * The profile a new chat uses when none was given.
 *
 * Prefers a profile named for the job, because the `default` profile carries a
 * ~66,000-character system prompt in its config — every message through it would
 * cost ~16k tokens. Any purpose-made chat profile is a fraction of that.
 */
async function defaultChatProfile(): Promise<string> {
  const profiles = await listProfiles()
  const preferred = process.env.CHAT_PROFILE || 'office-chat'
  if (profiles.includes(preferred)) return preferred
  // Fall back to any non-default profile; `default` only if that is all there is.
  return profiles.find((p) => p !== 'default') || profiles[0] || ''
}
