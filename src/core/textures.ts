import * as THREE from 'three'

/**
 * Procedural textures for the pool. Generated in code, so the page makes no
 * network requests — Towers' discipline, and it means the look is parameterised
 * rather than baked into a file.
 */

/**
 * Caustics.
 *
 * The bright wandering filaments on the floor of any pool: sunlight refracted by
 * a moving surface, focused into lines where the wavefronts fold over
 * themselves. Faked here as the interference of two sine fields that each warp
 * the other's phase, which produces the same characteristic branching web.
 *
 * `Math.pow(v, 5)` is what turns a soft interference pattern into caustics.
 * Real caustics are almost all dark with thin brilliant lines, and a linear
 * mapping gives an evenly mottled grey that reads as noise instead of light.
 *
 * Frequencies are integers so the pattern tiles: any non-integer term produces
 * a visible seam once the texture repeats.
 */
export function makeCausticsTexture(size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const data = image.data

  const TAU = Math.PI * 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TAU
      const v = (y / size) * TAU

      // Each field warps the other's phase — that mutual folding is what makes
      // the lines branch rather than form a regular grid.
      const a = Math.sin(u * 3 + Math.sin(v * 2) * 1.6)
      const b = Math.sin(v * 3 + Math.sin(u * 2) * 1.6)
      const c = Math.sin((u + v) * 2 + Math.sin(u * 3 - v) * 1.1)

      let n = Math.abs(a + b + c) / 3
      n = Math.pow(n, 5) * 1.9
      const value = Math.max(0, Math.min(1, n)) * 255

      const i = (y * size + x) * 4
      // Caustics carry the water's colour, so the blue channel survives longest.
      data[i] = value * 0.72
      data[i + 1] = value * 0.9
      data[i + 2] = value
      data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Poured concrete for the pool wall and floor.
 *
 * Low-frequency blotching plus fine grain. The blotches matter more than the
 * grain: a perfectly even surface reads as plastic no matter how fine the noise
 * on it, because real concrete varies over hand-sized patches where it was
 * floated, not just at the millimetre scale.
 */
export function makeConcreteTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#6f7680'
  ctx.fillRect(0, 0, size, size)

  // Broad float marks.
  for (let i = 0; i < 160; i++) {
    const r = 30 + Math.random() * 120
    const x = Math.random() * size
    const y = Math.random() * size
    const light = Math.random() > 0.5
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const alpha = 0.03 + Math.random() * 0.05
    g.addColorStop(0, light ? `rgba(210,216,224,${alpha})` : `rgba(40,46,54,${alpha})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Aggregate grain.
  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26
    data[i] = Math.max(0, Math.min(255, data[i] + n))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n))
  }
  ctx.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Roughness map derived from a colour map's luminance.
 *
 * One image doing the work of two. Rec.709 weights rather than a flat average —
 * a naive mean reads red and blue far too bright and produces relief that
 * disagrees with what the eye sees in the colour map.
 *
 * Data maps must stay in NoColorSpace: these are numbers, not colours, and
 * tagging them sRGB applies a transfer curve to a value that has no business
 * receiving one.
 */
export function roughnessFromColour(source: THREE.CanvasTexture, lo = 0.35, hi = 0.95) {
  const src = source.image as HTMLCanvasElement
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(src, 0, 0)

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255
    // Bright patches are the smoother, floated ones — so roughness inverts luma.
    const v = (hi - luma * (hi - lo)) * 255
    data[i] = data[i + 1] = data[i + 2] = v
  }
  ctx.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}
