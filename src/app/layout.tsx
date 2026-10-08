import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hermes Virtual Office',
  description:
    'An open-source 3D virtual workspace and meeting simulator for autonomous AI agents.',
}

/**
 * Next sudah mengirim width=device-width & initial-scale=1 sendiri; yang ditambahkan:
 * - viewportFit cover: tanpa ini env(safe-area-inset-*) selalu 0, jadi HP berponi /
 *   gesture bar tidak bisa dihormati oleh CSS.
 * - interactiveWidget resizes-content: di Chrome Android keyboard layar mengecilkan
 *   viewport (dan 100dvh), sehingga input chat terdorong naik, bukan tertutup.
 * Zoom pengguna sengaja TIDAK dikunci; masalah auto-zoom iOS diselesaikan dengan
 * font input 16px di globals.css.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#0f1418',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
