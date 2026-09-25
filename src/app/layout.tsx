import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hermes Virtual Office',
  description:
    'An open-source 3D virtual workspace and meeting simulator for autonomous AI agents.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
