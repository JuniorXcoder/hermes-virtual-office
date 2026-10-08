/**
 * DOCTOR "Siap pakai?" — pemeriksaan menyeluruh sebelum pengguna baru bingung.
 *
 * Kenapa file ini ada: kantor 3D-nya jalan, tapi tombol bisa gagal diam-diam
 * (rapat ditolak, A2A tidak nyala, chat gagal tanpa model). Panel doctor
 * memeriksa tiap lapisan dan menampilkan lulus/gagal + langkah perbaikan
 * yang bisa disalin.
 *
 * ATURAN JUJUR (sama seperti SystemPanel): yang tidak bisa dipastikan bilang
 * "tidak bisa dipastikan" (status 'unknown') — JANGAN lampu hijau untuk yang
 * cuma "kelihatannya beres".
 *
 * Fungsi pure (parseA2aPlatform, classifyServed, parseGatewayStart,
 * needsRestart, originVerdict) dipisah supaya selftest menguji tanpa CLI.
 */

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const TIMEOUT_MS = Number(process.env.KANBAN_TIMEOUT_MS || 20_000)

export type DoctorStatus = 'pass' | 'fail' | 'unknown'

export type DoctorCheck = {
  id: string
  label: string
  status: DoctorStatus
  /** Fakta apa adanya (angka, nama, pesan error asli). */
  detail: string
  /** Langkah perbaikan yang bisa disalin. Kosong bila lulus. */
  fix: string
}

export type DoctorReport = {
  readAt: string
  hermesBin: string
  checks: DoctorCheck[]
}

/**
 * MODEL-PROVIDER-1: klasifikasi pure "provider menggantung".
 *
 * `model.provider: custom:<nama>` hanya hidup bila definisi `custom_providers`
 * bernama `<nama>` ada DI SCOPE PROFIL ITU (bukan cuma global). Tanpa itu chat
 * mati dengan "Unknown provider" walau model default terisi.
 *
 * - provider non-custom (null, "openai", ...) = 'ok' (di luar urusan blok ini).
 * - definisi tak terbaca (null) = 'unknown' (jujur, bukan lulus).
 * - custom tanpa definisi cocok = 'dangling' (rusak).
 * - custom dengan definisi cocok = 'ok'.
 */
export function classifyProviderScope(
  provider: string | null,
  defs: { name?: string }[] | null,
): 'ok' | 'dangling' | 'unknown' {
  const pv = (provider || '').trim()
  if (!pv.toLowerCase().startsWith('custom:')) return 'ok'
  const need = pv.slice('custom:'.length).trim().toLowerCase()
  if (defs === null) return 'unknown'
  const have = (defs || []).some((d) => String(d?.name || '').trim().toLowerCase() === need)
  return have ? 'ok' : 'dangling'
}

/** Env tanpa penanda sesi agent — sama kontraknya dengan cleanEnv() di kanban.ts. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of [
    'HERMES_DELEGATED_CHILD_CONTEXT',
    'HERMES_SUPERVISED_CHILD',
    'HERMES_SESSION_ID',
    'HERMES_SESSION_PLATFORM',
    'HERMES_SESSION_CHAT_ID',
    'HERMES_SESSION_USER_ID',
  ]) {
    delete env[k]
  }
  return env
}

/* ---------------------------------------------------------------- pure --- */

/**
 * Hasil `hermes config get platforms.a2a --json` → { found, enabled, port }.
 * found=false = kunci belum ada sama sekali (bukan "mati" — beda perbaikannya).
 */
export function parseA2aPlatform(raw: unknown): {
  found: boolean
  enabled: boolean
  port: number | null
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { found: false, enabled: false, port: null }
  }
  const r = raw as { enabled?: unknown; port?: unknown }
  const port = typeof r.port === 'number' && Number.isFinite(r.port) ? r.port : null
  return { found: true, enabled: r.enabled === true, port }
}

/**
 * Entri served yang profilnya sudah tidak ada = BASI: tercatat tapi tidak
 * akan pernah menjawab. Basi ditandai, bukan dihitung sebagai siap.
 */
export function classifyServed(
  served: { profile: string; slug: string }[],
  profiles: string[],
): { profile: string; slug: string; stale: boolean }[] {
  const have = new Set(profiles.map((p) => p.trim().toLowerCase()))
  return served.map((s) => ({
    profile: s.profile,
    slug: s.slug,
    stale: !have.has(s.profile.trim().toLowerCase()),
  }))
}

/**
 * `systemctl --user show hermes-gateway -p ActiveEnterTimestamp --value`
 * menjawab "Thu 2026-10-08 22:44:31 WIB". Sufiks zona ("WIB") dibuang —
 * Date.parse tidak mengenalnya — sisanya dibaca sebagai waktu lokal server.
 * Tak terparse = null = "tidak bisa dipastikan", bukan 0.
 */
export function parseGatewayStart(out: string): number | null {
  const line = out.trim().split('\n').pop()?.trim() ?? ''
  if (!line || line === 'ActiveEnterTimestamp=') return null
  const cleaned = line
    .replace(/^ActiveEnterTimestamp=/, '')
    .replace(/\s+[A-Z]{2,5}$/, '')
    .trim()
  const t = Date.parse(cleaned)
  return Number.isFinite(t) ? t : null
}

/**
 * Daftar served dibaca SEKALI saat gateway boot: config lebih baru dari
 * start gateway = entri baru tersimpan tapi belum aktif.
 * gatewayStartMs null = start tak diketahui → null (tidak bisa dipastikan).
 */
export function needsRestart(configMtimeMs: number, gatewayStartMs: number | null): boolean | null {
  if (gatewayStartMs === null) return null
  return configMtimeMs > gatewayStartMs
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function bareHost(host: string): string {
  return host.replace(/:\d+$/, '')
}

/**
 * Putusan tulis untuk Host/Origin yang meminta panel ini.
 *
 * Logikanya sama dengan local-guard.ts (itu yang dipakai route tulis —
 * ini cermin read-only untuk ditampilkan). allowedRaw = isi mentah
 * ALLOWED_ORIGINS (koma, boleh pakai skema).
 *
 * Tanpa header Origin (fetch server-ke-server, curl) = 'unknown': panel
 * tidak bisa tahu browser akan mengirim apa — bilang begitu, bukan lulus.
 */
export function originVerdict(
  hostHeader: string | null,
  originHeader: string | null,
  allowedRaw: string,
): { status: DoctorStatus; detail: string; fix: string } {
  if (!hostHeader || !originHeader) {
    return {
      status: 'unknown',
      detail: 'tidak bisa dipastikan — panel diminta tanpa header Origin (buka panel ini dari browser untuk memeriksa)',
      fix: '',
    }
  }
  let host: URL
  let origin: URL
  try {
    host = new URL(`http://${hostHeader}`)
    origin = new URL(originHeader)
  } catch {
    return {
      status: 'fail',
      detail: `header Host/Origin tidak terbaca: Host="${hostHeader}" Origin="${originHeader}"`,
      fix: 'buka panel dari browser biasa (bukan curl tanpa header)',
    }
  }
  if (origin.host !== host.host) {
    return {
      status: 'fail',
      detail: `Origin "${origin.host}" tidak sama dengan Host "${host.host}" — tulisan akan dijawab 403`,
      fix: `buka kantor lewat alamat yang sama dengan Origin, atau samakan keduanya`,
    }
  }
  if (origin.protocol !== 'http:') {
    return {
      status: 'fail',
      detail: `skema Origin "${origin.protocol}" bukan http — penjaga tulis hanya menerima http same-origin`,
      fix: 'buka kantor lewat http:// (atau perbarui penjaga bila sudah https)',
    }
  }
  const allowed = allowedRaw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .filter(Boolean)
  const h = host.host.toLowerCase()
  const trusted = LOOPBACK.has(bareHost(h)) || allowed.some((e) => e === h || e === bareHost(h))
  if (trusted) {
    return { status: 'pass', detail: `Origin "${origin.host}" sama dengan Host dan dipercaya`, fix: '' }
  }
  return {
    status: 'fail',
    detail: `"${h}" bukan loopback dan tidak ada di ALLOWED_ORIGINS — tulisan akan dijawab 403`,
    fix: `tambahkan "${h}" ke ALLOWED_ORIGINS di .env.local, lalu restart`,
  }
}

/* ---------------------------------------------------------------- live --- */

/**
 * Start gateway lewat `systemctl --user show`. Office jalan sebagai service
 * SISTEM (tanpa user bus), jadi argv systemctl butuh XDG_RUNTIME_DIR=/run/user/0
 * — tanpa itu stdout kosong dan start "tak terbaca" padahal gateway hidup.
 * Bila systemctl tetap gagal, fallback: PID di gateway.pid → waktu start
 * proses itu (Platform M = restart tak terdeteksi hanya bila keduanya gagal).
 */
export async function gatewayStartMs(): Promise<number | null> {
  const env = { ...cleanEnv(), XDG_RUNTIME_DIR: '/run/user/0' }
  try {
    const { stdout } = await run(
      'systemctl',
      ['--user', 'show', 'hermes-gateway', '-p', 'ActiveEnterTimestamp', '--value'],
      { env, timeout: 10_000, maxBuffer: 64 * 1024 },
    )
    const t = parseGatewayStart(stdout)
    if (t !== null) return t
  } catch {
    // jatuh ke fallback PID di bawah
  }
  try {
    const { hermesHome } = await import('./kanban')
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const raw = await readFile(path.join(hermesHome(), 'gateway.pid'), 'utf8')
    const pid = Number(JSON.parse(raw)?.pid)
    if (Number.isFinite(pid) && pid > 0) {
      const { stdout } = await run('ps', ['-o', 'lstart=', '-p', String(pid)], {
        env: cleanEnv(),
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      })
      const t = Date.parse(stdout.trim())
      if (Number.isFinite(t)) return t
    }
  } catch {
    // dua-duanya gagal = benar-benar tak bisa dipastikan
  }
  return null
}

export async function runDoctor(opts: { host: string | null; origin: string | null }): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []

  // 1. Hermes CLI ketemu & bisa dipanggil.
  let cliOk = false
  let cliVersion = ''
  try {
    const { stdout } = await run(HERMES_BIN, ['--version'], {
      env: cleanEnv(),
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
    cliOk = true
    cliVersion = stdout.trim().split('\n')[0].slice(0, 80)
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    checks.push({
      id: 'cli',
      label: 'Hermes CLI ketemu & bisa dipanggil',
      status: 'fail',
      detail:
        e.code === 'ENOENT'
          ? `tidak ada executable di "${HERMES_BIN}"`
          : `gagal menjalankan "${HERMES_BIN}": ${(e.stderr || e.message || '').trim().slice(0, 300)}`,
      fix: `set HERMES_BIN ke path executable hermes (sekarang: "${HERMES_BIN}")`,
    })
  }
  if (cliOk) {
    checks.push({
      id: 'cli',
      label: 'Hermes CLI ketemu & bisa dipanggil',
      status: 'pass',
      detail: `"${HERMES_BIN}" menjawab: ${cliVersion || '(tanpa versi)'}`,
      fix: '',
    })
  }

  // Modul berat diimpor malas: kalau CLI mati, doctor tetap bisa menilai
  // origin tanpa menarik seluruh jembatan kanban.
  const { listProfiles, listTasks, profileModel, profileCustomProviders, hermesHome } = await import('./kanban')
  const { isConfigured } = await import('./meeting')
  const { listServedAgents } = await import('./a2a-served')

  // 2. Board bisa dibaca.
  let taskCount: number | null = null
  try {
    const tasks = await listTasks()
    taskCount = tasks.length
    checks.push({
      id: 'board',
      label: 'Board bisa dibaca',
      status: 'pass',
      detail: `${tasks.length} task terbaca lewat CLI`,
      fix: '',
    })
  } catch (err) {
    checks.push({
      id: 'board',
      label: 'Board bisa dibaca',
      status: 'fail',
      detail: (err as Error).message.slice(0, 300),
      fix: 'perbaiki error di atas apa adanya — biasanya HERMES_BIN atau board yang ditunjuk HERMES_KANBAN_BOARD',
    })
  }

  // 3. Profil agent ada.
  let profiles: string[] | null = null
  try {
    profiles = await listProfiles()
    if (!profiles.length) {
      checks.push({
        id: 'profiles',
        label: 'Profil agent ada',
        status: 'fail',
        detail: 'tidak ada profil sama sekali',
        fix: 'bikin dari form Agent, atau: hermes profile create <nama> --no-alias',
      })
    } else {
      checks.push({
        id: 'profiles',
        label: 'Profil agent ada',
        status: 'pass',
        detail: `${profiles.length} profil: ${profiles.slice(0, 8).join(', ')}${profiles.length > 8 ? ` (+${profiles.length - 8})` : ''}`,
        fix: '',
      })
    }
  } catch (err) {
    checks.push({
      id: 'profiles',
      label: 'Profil agent ada',
      status: 'fail',
      detail: (err as Error).message.slice(0, 300),
      fix: 'bikin dari form Agent, atau: hermes profile create <nama> --no-alias',
    })
  }

  // 4. Profil punya model (tanpa model, chat gagal).
  if (!profiles) {
    checks.push({
      id: 'models',
      label: 'Profil punya model',
      status: 'unknown',
      detail: 'tidak bisa dipastikan — daftar profil sendiri gagal dibaca',
      fix: '',
    })
  } else if (!profiles.length) {
    checks.push({
      id: 'models',
      label: 'Profil punya model',
      status: 'unknown',
      detail: 'tidak bisa dipastikan — tidak ada profil untuk diperiksa',
      fix: '',
    })
  } else {
    const models = await Promise.all(profiles.map(async (p) => ({ p, ...(await profileModel(p)) })))
    // NOTE: `models` also feeds the dangling-provider verdict below — keep the
    // two loops over the same snapshot, not two separate reads.
    const missing = models.filter((m) => !m.model).map((m) => m.p)
    if (!missing.length) {
      checks.push({
        id: 'models',
        label: 'Profil punya model',
        status: 'pass',
        detail: `semua ${profiles.length} profil punya model default`,
        fix: '',
      })
    } else {
      checks.push({
        id: 'models',
        label: 'Profil punya model',
        status: 'fail',
        detail: `tanpa model: ${missing.join(', ')} — chat ke mereka akan gagal`,
        fix: `isi model tiap profil (pemilih model di form Agent), atau: hermes -p <nama> config set model.default <model>`,
      })
    }
    // Provider menggantung: `model.provider: custom:<nama>` tanpa definisi
    // `custom_providers` bernama itu di scope profil = chat mati dengan
    // "Unknown provider", walau model default ADA. Periksa lama lulus untuk
    // kasus ini — sekarang gagal jujur + langkah perbaikan yang bisa disalin.
    const customNames = models
      .map((m) => {
        const pv = (m.provider || '').trim()
        return pv.toLowerCase().startsWith('custom:') ? pv.slice('custom:'.length).trim().toLowerCase() : null
      })
      .filter((n): n is string => !!n)
    if (customNames.length) {
      const defs = await Promise.all(profiles.map(async (p) => ({ p, defs: await profileCustomProviders(p) })))
      const dangling: string[] = []
      const unreadable: string[] = []
      for (const m of models) {
        const row = defs.find((d) => d.p === m.p)
        const verdict = classifyProviderScope(m.provider, row?.defs ?? null)
        // row hilang = profil lenyap di tengah baca: tak bisa dipastikan.
        if (!row) {
          unreadable.push(m.p)
        } else if (verdict === 'dangling') {
          dangling.push(`${m.p} (provider "${(m.provider || '').trim()}" tanpa definisi)`)
        } else if (verdict === 'unknown') {
          unreadable.push(m.p)
        }
      }
      if (dangling.length) {
        checks.push({
          id: 'model-providers',
          label: 'Provider model bisa diresolusi',
          status: 'fail',
          detail: `provider menggantung: ${dangling.join(', ')} — chat ke mereka mati ("Unknown provider")`,
          fix: `salin definisi dari config global ke tiap profil, contoh:\nhermes -p <nama> config set custom_providers "$(hermes config get custom_providers --json)"\natau pilih ulang model dari pemilih model di form Agent (sekarang menyalin definisinya otomatis)`,
        })
      } else if (unreadable.length) {
        checks.push({
          id: 'model-providers',
          label: 'Provider model bisa diresolusi',
          status: 'unknown',
          detail: `tidak bisa dipastikan — definisi provider tak terbaca untuk: ${unreadable.join(', ')}`,
          fix: '',
        })
      } else {
        checks.push({
          id: 'model-providers',
          label: 'Provider model bisa diresolusi',
          status: 'pass',
          detail: `semua provider custom (${[...new Set(customNames)].join(', ')}) ada definisinya di scope tiap profil`,
          fix: '',
        })
      }
    }
  }

  // 5. Provider LLM untuk rapat simulasi.
  if (isConfigured()) {
    checks.push({
      id: 'simulasi',
      label: 'Provider LLM rapat simulasi',
      status: 'pass',
      detail: 'AI_BASE_URL + AI_API_KEY terisi — rapat mode simulasi bisa jalan',
      fix: '',
    })
  } else {
    checks.push({
      id: 'simulasi',
      label: 'Provider LLM rapat simulasi',
      status: 'fail',
      detail: 'AI_BASE_URL/AI_API_KEY kosong — rapat simulasi akan menjawab "not configured"',
      fix: 'isi AI_BASE_URL + AI_API_KEY di .env.local (lihat .env.example). Rapat mode a2a TIDAK butuh ini — agent nyata yang bicara.',
    })
  }

  // 6. Platform A2A nyala.
  let a2aEnabled = false
  try {
    const { stdout } = await run(HERMES_BIN, ['config', 'get', 'platforms.a2a', '--json'], {
      env: cleanEnv(),
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    })
    const start = stdout.search(/[[{]/)
    const parsed = parseA2aPlatform(start < 0 ? null : JSON.parse(stdout.slice(start)))
    if (!parsed.found || !parsed.enabled) {
      checks.push({
        id: 'a2a-platform',
        label: 'Platform A2A nyala',
        status: 'fail',
        detail: parsed.found ? 'platforms.a2a ada tapi enabled bukan true' : 'platforms.a2a belum ada di config Hermes',
        fix: 'hermes config set platforms.a2a.enabled true --force\nhermes config set platforms.a2a.port 9900 --force\nlalu restart gateway',
      })
    } else if (parsed.port === null) {
      checks.push({
        id: 'a2a-platform',
        label: 'Platform A2A nyala',
        status: 'fail',
        detail: 'enabled true tapi port tidak terbaca',
        fix: 'hermes config set platforms.a2a.port 9900 --force\nlalu restart gateway',
      })
    } else {
      a2aEnabled = true
      checks.push({
        id: 'a2a-platform',
        label: 'Platform A2A nyala',
        status: 'pass',
        detail: `enabled, port ${parsed.port} (tanpa token, server mengikat loopback saja)`,
        fix: '',
      })
    }
  } catch (err) {
    checks.push({
      id: 'a2a-platform',
      label: 'Platform A2A nyala',
      status: 'unknown',
      detail: `tidak bisa dipastikan — config tak terbaca: ${(err as Error).message.slice(0, 200)}`,
      fix: '',
    })
  }

  // 7. Agen yang di-serve (entri basi ditandai, bukan dihitung siap).
  if (!profiles) {
    checks.push({
      id: 'served',
      label: 'Agen yang di-serve',
      status: 'unknown',
      detail: 'tidak bisa dipastikan — daftar profil gagal dibaca, basi tidak bisa dinilai',
      fix: '',
    })
  } else {
    try {
      const served = await listServedAgents()
      const rows = classifyServed(served, profiles)
      const fresh = rows.filter((r) => !r.stale)
      const stale = rows.filter((r) => r.stale)
      const wrongLocal = served.filter((s) => s.local !== false)
      const detail: string[] = []
      if (fresh.length) detail.push(`siap: ${fresh.map((r) => r.profile).join(', ')}`)
      if (stale.length) detail.push(`BASI (profil hilang): ${stale.map((r) => r.profile).join(', ')}`)
      if (wrongLocal.length) detail.push(`local:true (identitas salah): ${wrongLocal.map((s) => s.profile).join(', ')}`)
      if (!served.length) detail.push('belum ada agent yang di-serve')
      if (stale.length || wrongLocal.length || !fresh.length) {
        const fixes: string[] = []
        if (!fresh.length) fixes.push('daftarkan agent lewat toggle A2A di form Agent (aplikasi menulis local:false)')
        if (stale.length) fixes.push(`cabut entri basi: ${stale.map((r) => r.profile).join(', ')} (toggle mati di form Agent)`)
        if (wrongLocal.length) fixes.push('local HARUS false — true berarti yang menjawab sesi gateway umum, identitas agent salah')
        if (a2aEnabled && fresh.length) fixes.push('lalu restart gateway (daftar served dibaca sekali saat boot)')
        checks.push({
          id: 'served',
          label: 'Agen yang di-serve',
          status: 'fail',
          detail: detail.join(' · '),
          fix: fixes.join('\n'),
        })
      } else {
        const platformNote = a2aEnabled ? '' : ' — platform A2A sendiri belum terverifikasi nyala (lihat periksa di atas)'
        checks.push({
          id: 'served',
          label: 'Agen yang di-serve',
          status: 'pass',
          detail: `${fresh.length} siap: ${fresh.map((r) => r.profile).join(', ')}${platformNote}`,
          fix: '',
        })
      }
    } catch (err) {
      checks.push({
        id: 'served',
        label: 'Agen yang di-serve',
        status: 'unknown',
        detail: `tidak bisa dipastikan — daftar served tak terbaca: ${(err as Error).message.slice(0, 200)}`,
        fix: '',
      })
    }
  }

  // 8. Butuh restart gateway? (mtime config.yaml vs start gateway —
  // helper gatewayStartMs menangani service sistem tanpa user bus).
  try {
    const home = hermesHome()
    const mtime = (await stat(`${home}/config.yaml`)).mtimeMs
    const startMs = await gatewayStartMs()
    const need = needsRestart(mtime, startMs)
    if (need === null) {
      checks.push({
        id: 'restart',
        label: 'Butuh restart gateway?',
        status: 'unknown',
        detail: 'tidak bisa dipastikan — waktu start gateway tak terbaca (bukan service user systemd?)',
        fix: 'pastikan gateway jalan sebagai hermes-gateway user service, atau restart manual tiap habis mengubah served',
      })
    } else if (need) {
      checks.push({
        id: 'restart',
        label: 'Butuh restart gateway?',
        status: 'fail',
        detail: 'config.yaml lebih baru dari start gateway — entri served tersimpan tapi BELUM aktif',
        fix: 'Tersimpan, belum aktif — restart gateway:\nhermes gateway restart',
      })
    } else {
      checks.push({
        id: 'restart',
        label: 'Butuh restart gateway?',
        status: 'pass',
        detail: 'gateway start lebih baru dari config — served yang tersimpan sudah aktif',
        fix: '',
      })
    }
  } catch (err) {
    checks.push({
      id: 'restart',
      label: 'Butuh restart gateway?',
      status: 'unknown',
      detail: `tidak bisa dipastikan: ${(err as Error).message.slice(0, 200)}`,
      fix: '',
    })
  }

  // 9. Origin boleh menulis.
  const v = originVerdict(opts.host, opts.origin, process.env.ALLOWED_ORIGINS || '')
  checks.push({ id: 'origin', label: 'Origin boleh menulis', status: v.status, detail: v.detail, fix: v.fix })

  void taskCount
  return { readAt: new Date().toISOString(), hermesBin: HERMES_BIN, checks }
}
