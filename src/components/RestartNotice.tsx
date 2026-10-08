'use client'

/**
 * Pop up "SILAHKAN RESTART SERVER" — dipakai SETELAH spawn/menyimpan agent.
 *
 * Aturan jujur yang dipegang:
 * - Setelan TERSIMPAN tapi baru BERLAKU setelah restart (daftar served dibaca
 *   SEKALI saat gateway boot — tidak ada hot reload). Tidak ada "siap
 *   dipanggil" sebelum restart.
 * - Apa yang belum bisa sebelum restart: agent belum bisa dipanggil lewat A2A;
 *   rapat mode `a2a` akan menolaknya (menyebut dia belum di-serve).
 * - Pendaftaran GAGAL = pop up gagal (bukan pop up ini) — pemanggil yang
 *   memutuskan, bukan komponen ini.
 * - Tombol "Restart sekarang" memanggil route /api/hermes/gateway-restart
 *   (unit gw-restart.service, jalur yang SAMA dengan manual — bukan mekanisme
 *   kedua). Gagal = tampilkan perintah manual yang bisa disalin — jangan
 *   sukses palsu.
 * - Perintah restart portabel dulu (`hermes gateway restart`); unit
 *   gw-restart.service opsional host-specific. Path biner host TIDAK ditulis
 *   di UI publik (alat khusus satu host).
 */

import { useState } from 'react'
import { fetchJson } from '@/lib/api'

const MANUAL_CMD = 'hermes gateway restart'
const MANUAL_UNIT = 'systemctl --user start gw-restart.service'

export default function RestartNotice({
  agentName,
  onClose,
}: {
  /** Nama agent yang baru dibuat/disimpan — disebut di teks jujur. */
  agentName: string
  onClose: () => void
}) {
  const [restartBusy, setRestartBusy] = useState(false)
  /** null = belum dicoba; string = hasil mentah apa adanya (sukses/gagal). */
  const [restartResult, setRestartResult] = useState<string | null>(null)
  const [restartFailed, setRestartFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  async function restartNow() {
    setRestartBusy(true)
    setRestartResult(null)
    setRestartFailed(false)
    try {
      const res = await fetchJson<{ message?: string; manual?: string[] }>(
        '/api/hermes/gateway-restart',
        { method: 'POST' },
      )
      if (res.ok) {
        // Jujur: dijadwalkan, BUKAN selesai. Halaman akan putus sebentar.
        setRestartResult(res.data?.message ?? 'Restart dijadwalkan.')
        setRestartFailed(false)
      } else {
        setRestartResult(
          `${res.error ?? 'Restart gagal dijadwalkan.'} Jalankan manual: ${(res.data?.manual ?? [MANUAL_CMD]).join('  ·  ')}`,
        )
        setRestartFailed(true)
      }
    } catch (e) {
      setRestartResult(`Restart gagal dijadwalkan (${(e as Error).message}). Jalankan manual: ${MANUAL_CMD}`)
      setRestartFailed(true)
    } finally {
      setRestartBusy(false)
    }
  }

  async function copyManual() {
    try {
      await navigator.clipboard.writeText(`${MANUAL_CMD}\n${MANUAL_UNIT}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard ditolak: teks tetap terlihat, salin manual
    }
  }

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Silahkan restart server</h3>
        <p className="vp-sub">
          Setelan &quot;{agentName}&quot; TERSIMPAN, tapi baru BERLAKU setelah server restart — daftar served-agent
          dibaca SEKALI saat gateway boot, tidak ada hot reload.
        </p>
        <p className="vp-note">
          Sebelum restart: &quot;{agentName}&quot; BELUM bisa dipanggil lewat A2A, dan rapat mode <b>a2a</b> akan
          menolaknya (menyebut dia belum di-serve).
        </p>
        {!restartResult && (
          <div className="vp-modal-actions">
            <button className="vp-btn" onClick={onClose}>
              Nanti saja
            </button>
            <button className="vp-btn primary" onClick={() => void restartNow()} disabled={restartBusy}>
              {restartBusy ? 'Menjadwalkan…' : 'Restart sekarang'}
            </button>
          </div>
        )}
        {restartResult && (
          <div className={restartFailed ? 'vp-err' : 'vp-ok'}>
            {restartResult}
            {restartFailed && (
              <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
                <textarea
                  rows={2}
                  readOnly
                  value={`${MANUAL_CMD}\n${MANUAL_UNIT}`}
                  aria-label="Perintah restart manual"
                  style={{ width: '100%' }}
                />
                <div>
                  <button className="vp-chip-btn" onClick={() => void copyManual()}>
                    {copied ? 'tersalin ✓' : 'salin perintah'}
                  </button>
                </div>
              </div>
            )}
            <div className="vp-modal-actions" style={{ marginTop: 8 }}>
              <button className="vp-btn primary" onClick={onClose} autoFocus>
                Mengerti
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
