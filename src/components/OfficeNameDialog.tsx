'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'

/**
 * Office name editor (poin 1).
 *
 * Opened by clicking the name plate above the entrance. The value is stored in
 * `office_meta` (data/office.db), so it survives a reload and belongs to the office
 * rather than to one browser.
 */
export default function OfficeNameDialog({ onClose }: { onClose: () => void }) {
  const officeName = useOffice((s) => s.officeName)
  const setOfficeName = useOffice((s) => s.setOfficeName)
  const [value, setValue] = useState(officeName)
  const [busy, setBusy] = useState(false)

  useEffect(() => setValue(officeName), [officeName])

  async function save() {
    setBusy(true)
    await setOfficeName(value)
    setBusy(false)
    onClose()
  }

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nama kantor</h3>
        <p className="vp-sub">Muncul di papan nama atas pintu masuk. Tersimpan di database.</p>
        <label className="vp-field">
          <span>Nama</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={60}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
          />
        </label>
        <div className="vp-modal-actions">
          <button className="vp-btn" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="vp-btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
