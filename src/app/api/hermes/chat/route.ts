import { NextRequest, NextResponse } from 'next/server'
import { chatLiveAgents } from '@/lib/office/duty'
import {
  chatTurnsInFlight,
  getChatSession,
  listChatSessions,
  readChatHistory,
  resetChatSession,
  sendChatMessage,
} from '@/lib/hermes/chat'
import { listAgents, listProfiles, listTasks } from '@/lib/hermes/kanban'
import { visibleNames } from '@/lib/hermes/office-membership'
import { assertLocalWriteRequest } from '@/lib/local-guard'

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
    // `?live=1` — siapa yang sedang diajak bicara, untuk kantor (agent pergi ke mejanya).
    // Dipisah dari daftar biasa karena daftar biasa memanggil CLI (profil, papan) dan ini
    // dipoll tiap beberapa detik; yang ini hanya membaca indeks sesi dan memori proses.
    if (req.nextUrl.searchParams.get('live') === '1') {
      const now = Date.now()
      return NextResponse.json({
        live: chatLiveAgents(await listChatSessions(), chatTurnsInFlight(), now),
        inFlight: chatTurnsInFlight(),
        at: new Date(now).toISOString(),
      })
    }
    if (!agent) {
      // An agent IS a profile — one name, one memory store. The panel used to ask
      // for a separate "profile for new chats", which was nonsense: `jun` the agent
      // runs as the `jun` profile, so there was never a second choice to make. What
      // it exposed was the mismatch between the board's assignee list and the
      // install's profile list, which is an internal detail, not a user decision.
      const profiles = await chatProfiles()
      const known = new Set(profiles)
      return NextResponse.json({
        sessions: await listChatSessions(),
        /**
         * Everyone you can talk to: every profile, plus any board assignee that has
         * no profile yet (so the list matches the office floor).
         */
        // Hidden profiles are filtered here too. `default` in particular used to be
        // special-cased IN (`|| n === 'default'`), which is why the install's own
        // orchestrator profile showed up as somebody you could chat with.
        agents: visibleNames(
          (await listAgents(await listTasks()))
            .map((a) => a.name)
            .filter((n) => known.has(n)),
        ),
        /** Profiles that exist. Used to tell "can chat" from "needs a profile". */
        profiles,
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
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  const agent = typeof body?.agent === 'string' ? body.agent.trim() : ''
  const message = typeof body?.message === 'string' ? body.message : ''

  if (!agent) {
    return bad('agent wajib')
  }
  if (!message.trim()) {
    return bad('pesan kosong')
  }

  try {
    // The agent name IS the profile name. One agent, one profile, one memory store.
    const profile = agent

    const known = await listProfiles()
    if (!known.includes(profile)) {
      return bad(`profil "${profile}" tidak ada — buat agentnya dulu`)
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
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
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
