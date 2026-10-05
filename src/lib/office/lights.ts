/**
 * Cahaya 3 titik: matahari + langit + lampu hangat interior.
 *
 * Look kartun = 1 lampu flat. Look realistis = matahari berarah (bayangan
 * lembut) + hemisphere langit/tanah (fill) + point hangat di dalam ruangan.
 */
import * as THREE from 'three'

export type LightRig = {
  sun: THREE.DirectionalLight
  sky: THREE.HemisphereLight
  warm: THREE.PointLight[]
}

/**
 * Pasang rig cahaya ke scene. Kembalikan rig agar build.ts bisa daftarkan
 * lampu hangat ke `lamps[]` (untuk palette siang/malam).
 */
export function setupLights(scene: THREE.Scene, hour: number, warmPoints: { x: number; y: number; z: number }[] = []): LightRig {
  const night = hour >= 18 || hour < 6
  const sun = new THREE.DirectionalLight(night ? 0xc9d8ee : 0xfff2df, night ? 1.1 : 2.2)
  sun.position.set(18, 26, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.radius = 4 // bayangan lembut
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.02
  const cam = sun.shadow.camera as THREE.OrthographicCamera
  cam.left = -34
  cam.right = 34
  cam.top = 34
  cam.bottom = -34
  cam.near = 1
  cam.far = 90
  cam.updateProjectionMatrix()
  scene.add(sun)

  const sky = new THREE.HemisphereLight(0xbfd4e6, 0x8a7a5f, night ? 0.5 : 0.9)
  scene.add(sky)

  const warm = warmPoints.map((p) => {
    const l = new THREE.PointLight(0xffc98a, night ? 30 : 8, 12, 2)
    l.position.set(p.x, p.y, p.z)
    scene.add(l)
    return l
  })
  return { sun, sky, warm }
}
