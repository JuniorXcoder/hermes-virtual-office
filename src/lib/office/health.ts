/**
 * KESEHATAN SISTEM — satu tempat yang memutuskan "ada yang salah".
 *
 * Kenapa ini ada. Panel Sistem membuat kegagalan BISA DILIHAT, tapi hanya kalau ada yang
 * membukanya. Kenyataannya provider sudah balas 503 selama berjam-jam dan tidak ada yang tahu
 * — karena tidak ada yang membuka apa pun. Jadi ambangnya harus diputuskan DI SINI, sekali,
 * lalu dipakai oleh lampu di kantor, panel, dan selftest. Kalau ambangnya diketik ulang di
 * tiap tempat, cepat atau lambat tiga tempat itu berbeda pendapat.
 *
 * TINGKATNYA TIGA, DAN ITU DISENGAJA. Ruangan kontrol yang semua lampunya menyala sama
 * terang akan diabaikan orang — itulah alarm fatigue, dan itu penyebab kegagalan nyata di
 * ruangan nyata. Jadi:
 *
 *   hijau  — sistem sehat. Jangan tarik perhatian siapa pun.
 *   kuning — ada yang tidak beres tapi masih jalan.
 *   merah  — kerja sedang hilang SEKARANG. Ini yang boleh menarik perhatian.
 *
 * Ambang di bawah juga bukan angka bulat yang dipilih enak dilihat: tiap satunya punya alasan.
 */

/** Hasil penilaian. `reasons` selalu diisi kalau bukan hijau — lampu tanpa alasan tidak berguna. */
export type Health = {
  level: 'ok' | 'warn' | 'bad'
  reasons: string[]
}

/**
 * Ambang, dan alasan tiap angkanya.
 *
 * LOG_STALE_SEC   — errors.log ditulis setiap kali ada masalah. Diam 15 menit berarti PEMANTAUAN
 *                   yang mati, bukan sistem yang sehat. Ini kesalahan paling berbahaya di
 *                   ruangan kontrol: kabelnya lepas, lampunya hijau.
 * ERR_WARN/ERR_BAD— dihitung dalam 30 menit. 5 kegagalan itu wajar (satu retry gagal).
 *                   25 sudah bukan kebetulan; 80 berarti sesuatu sedang rusak terus-menerus.
 * SVR_WARN/BAD    — 5xx dari provider. Satu-dua kali itu gangguan biasa; 8 dalam 30 menit sudah
 *                   cukup untuk membatalkan pekerjaan yang sedang jalan, dan 30 berarti
 *                   providernya sedang mati.
 * COST_WARN/BAD   — biaya SEUMUR HIDUP, bukan harian. 5 dolar itu pemakaian normal; 400 sudah
 *                   perlu dilihat; 1000 perlu keputusan.
 * UNPRICED_WARN   — model tanpa tarif. Bukan kegagalan sistem, tapi artinya angka biaya yang
 *                   ditampilkan adalah BATAS BAWAH. Kalau ini tidak diberitahukan, totalnya
 *                   berbohong dengan halus.
 */
export const HEALTH_THRESHOLDS = {
  LOG_STALE_SEC: 900,
  ERR_WARN: 25,
  ERR_BAD: 80,
  SVR_WARN: 8,
  SVR_BAD: 30,
  COST_WARN: 400,
  COST_BAD: 1000,
  UNPRICED_WARN: 1,
} as const

export type HealthInput = {
  /** Umur errors.log dalam detik. -1 kalau tidak ketemu. */
  logAgeSeconds: number
  /** Jumlah baris bermasalah dalam jendela di bawah. */
  errorCount: number
  /** Berapa di antaranya 5xx dari provider. */
  serverErrorCount: number
  /** Biaya terhitung, seumur hidup. */
  costUsd: number
  /** Berapa model yang tarifnya belum diisi. */
  unpricedModels: number
  /** Apakah pembacaan datanya sendiri gagal. Kalau ya, ini MERAH apa pun isinya. */
  failure?: string
}

/**
 * Nilai kesehatan. DIURUTKAN: yang paling gawat menang.
 *
 * Urutan keparahannya bukan selera: kehilangan pemantauan (log basi) lebih buruk daripada
 * kegagalan yang terlihat, karena yang pertama berarti kamu TIDAK TAHU ada berapa banyak
 * masalah. Jadi log basi sendirian sudah cukup untuk MERAH.
 */
export function assessHealth(i: HealthInput): Health {
  const T = HEALTH_THRESHOLDS
  const reasons: string[] = []
  let level: Health['level'] = 'ok'

  // Tingkat hanya pernah NAIK. Ditulis sebagai satu aturan, bukan tiga kondisi yang saling
  // menimpa — versi sebelumnya punya perbandingan yang tidak mungkin benar dan lolos karena
  // kebetulan hasilnya sama.
  const rank = { ok: 0, warn: 1, bad: 2 } as const
  const raise = (l: Health['level'], why: string) => {
    reasons.push(why)
    if (rank[l] > rank[level]) level = l
  }

  // 0. Tidak bisa membaca = tidak tahu = MERAH. Ini yang paling penting: sistem yang tidak
  //    bisa melaporkan keadaannya sendiri tidak boleh tampil hijau.
  if (i.failure) {
    return { level: 'bad', reasons: [`tidak bisa membaca keadaan sistem: ${i.failure}`] }
  }

  // 1. Pemantauan mati.
  if (i.logAgeSeconds < 0) {
    return { level: 'bad', reasons: ['errors.log tidak ditemukan — tidak ada yang memantau'] }
  }
  if (i.logAgeSeconds > T.LOG_STALE_SEC) {
    return {
      level: 'bad',
      reasons: [`log tidak bertambah ${Math.round(i.logAgeSeconds / 60)} menit — pemantauan mungkin mati`],
    }
  }

  // 2. Kegagalan provider. Yang membatalkan kerja yang sedang jalan.
  if (i.serverErrorCount >= T.SVR_BAD) {
    raise('bad', `provider gagal ${i.serverErrorCount}× dalam 30 menit — kerja sedang hilang`)
  } else if (i.serverErrorCount >= T.SVR_WARN) {
    raise('warn', `provider gagal ${i.serverErrorCount}× dalam 30 menit`)
  }

  // 3. Kegagalan umum.
  if (i.errorCount >= T.ERR_BAD) raise('bad', `${i.errorCount} kegagalan dalam 30 menit`)
  else if (i.errorCount >= T.ERR_WARN) raise('warn', `${i.errorCount} kegagalan dalam 30 menit`)

  // 4. Biaya.
  if (i.costUsd >= T.COST_BAD) raise('warn', `biaya sudah $${i.costUsd.toFixed(0)} — perlu keputusan`)
  else if (i.costUsd >= T.COST_WARN) raise('warn', `biaya sudah $${i.costUsd.toFixed(0)}`)

  // 5. Angka biaya yang tidak lengkap. Bukan kegagalan, tapi totalnya menyesatkan.
  if (i.unpricedModels >= T.UNPRICED_WARN) {
    raise('warn', `${i.unpricedModels} model belum ada tarifnya — total biaya adalah batas bawah`)
  }

  return { level, reasons }
}

/** Warna lampu, dari tingkatnya. Dipakai kantor 3D dan panel, jadi keduanya tidak bisa beda. */
export const HEALTH_COLOR: Record<Health['level'], number> = {
  ok: 0x2f9e5e,
  warn: 0xd8a021,
  bad: 0xd03a2f,
}

/** Versi untuk CSS di panel. */
export const HEALTH_TW: Record<Health['level'], string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
}
