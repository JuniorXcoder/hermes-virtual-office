'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Tumpukan panel yang sedang terbuka. ESC hanya boleh menutup yang PALING ATAS:
 * pintasan keyboard bisa membuka Chat di atas Ruang rapat, dan satu ESC yang
 * menutup keduanya sekaligus terasa seperti kehilangan pekerjaan.
 */
const stack: string[] = []

export interface FullPanelProps {
  onClose: () => void
  /** Nama dialog untuk pembaca layar; judul bisa berupa elemen (Chat), jadi tidak bisa diandalkan. */
  label: string
  title: ReactNode
  /** Tombol tambahan di header, di kiri tombol tutup. */
  actions?: ReactNode
  /**
   * `vp`    — gaya panel kantor (Cron, Agent, Rapat, Chat).
   * `slate` — gaya Papan/Sistem apa adanya; pemilik aplikasi menyukai tampilan itu,
   *           jadi kelasnya disalin persis, hanya kerangkanya yang dipindah ke sini.
   */
  variant?: 'vp' | 'slate'
  /** Tinggi tetap, bukan sekadar batas — Chat butuh ruang transkrip walau masih kosong. */
  tall?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
}

export default function FullPanel({
  onClose,
  label,
  title,
  actions,
  variant = 'vp',
  tall = false,
  className = '',
  bodyClassName = '',
  children,
}: FullPanelProps) {
  const id = useId()
  const card = useRef<HTMLDivElement>(null)
  // Ditahan di ref supaya listener tidak dipasang ulang tiap render induk (panel-panel
  // ini mem-poll dan me-render ulang terus).
  const close = useRef(onClose)
  close.current = onClose
  // Klik baru dihitung "klik backdrop" kalau DIMULAI di backdrop: memblok teks di
  // dalam kartu lalu melepas mouse di luar tidak boleh menutup panel.
  const downOnBackdrop = useRef(false)

  useEffect(() => {
    stack.push(id)
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented = ada komponen di dalam (mis. menu model) yang sudah
      // memakai ESC untuk dirinya sendiri.
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (stack[stack.length - 1] !== id) return
      close.current()
    }
    addEventListener('keydown', onKey)

    // Fokus pindah ke panel supaya ESC dan pembaca layar langsung bekerja, tapi
    // jangan merebut fokus dari input yang sudah autoFocus di dalamnya.
    const before = document.activeElement as HTMLElement | null
    if (card.current && !card.current.contains(document.activeElement)) {
      card.current.focus({ preventScroll: true })
    }

    // Di HP, 100dvh belum tentu ikut mengecil saat keyboard layar muncul (iOS tidak
    // mengubah layout viewport). visualViewport adalah satu-satunya ukuran yang
    // jujur, jadi kartu disetel ke situ supaya input chat tidak tertutup keyboard.
    const vv = window.visualViewport
    const root = document.documentElement
    const fit = () => {
      if (!vv) return
      root.style.setProperty('--vp-vvh', `${vv.height}px`)
      root.style.setProperty('--vp-vvtop', `${vv.offsetTop}px`)
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)

    return () => {
      removeEventListener('keydown', onKey)
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      const at = stack.lastIndexOf(id)
      if (at >= 0) stack.splice(at, 1)
      if (!stack.length) {
        root.style.removeProperty('--vp-vvh')
        root.style.removeProperty('--vp-vvtop')
      }
      // Kembalikan fokus ke tombol top bar yang membuka panel, bukan ke <body>.
      if (before && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [id])

  const slate = variant === 'slate'

  return (
    <div
      className={`vp-full ${slate ? 'bg-black/70' : ''}`}
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose()
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`vp-full-card ${
          slate
            ? 'vp-full-slate max-h-[88vh] w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl'
            : `vp-full-vp${tall ? ' tall' : ''}`
        } ${className}`}
      >
        <header className={slate ? 'vp-full-head flex items-center justify-between px-5 pt-5 pb-4' : 'vp-panel-head vp-full-head'}>
          <div className="vp-full-title">
            {typeof title === 'string' ? (
              <h2 className={slate ? 'text-lg font-semibold' : undefined}>{title}</h2>
            ) : (
              title
            )}
          </div>
          <div className={`flex items-center gap-2 ${slate ? 'text-xs' : ''}`}>
            {actions}
            {slate ? (
              // Tampilan "tutup" Papan/Sistem dipertahankan; tombolnya sendiri 44×44
              // supaya mudah ditekan jari, margin negatif menjaga tinggi header tetap.
              <button className="vp-full-x -my-2.5" onClick={onClose} aria-label="Tutup">
                <span className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">tutup</span>
              </button>
            ) : (
              <button className="vp-x vp-full-x" onClick={onClose} aria-label="Tutup">
                ×
              </button>
            )}
          </div>
        </header>
        <div className={`vp-full-body ${slate ? 'px-5 pb-5' : ''} ${bodyClassName}`}>{children}</div>
      </div>
    </div>
  )
}
