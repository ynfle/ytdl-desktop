import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

/**
 * Generates high-DPI app icons (`desktop/build/icon.png` and `desktop/build/icon.ico`)
 * using pure Node built-ins.
 *
 * Aesthetic matches the in-app Sidebar brand badge:
 * - Warm amber/gold gradient (`#e8a849` -> `#d4893a`) rounded squircle
 * - Subtle inner highlight + deep dark icon emblem (play triangle + download tray)
 */

/** Precomputed CRC32 lookup table required by the PNG chunk specification. */
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c >>> 0
}

/** Computes the unsigned 32-bit CRC for a PNG chunk buffer. */
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** Encodes a single PNG chunk (`length` + `type` + `data` + `crc`). */
function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

/** Signed distance to a rounded rectangle centered at (cx, cy) with half-extents (hx, hy) and radius r. */
function sdRoundedBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - hx + r
  const qy = Math.abs(py - cy) - hy + r
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inDist = Math.min(Math.max(qx, qy), 0)
  return outDist + inDist - r
}

/** Signed distance from point (px, py) to a triangle (ax,ay)-(bx,by)-(cx,cy) (negative inside). */
function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax, e0y = by - ay
  const e1x = cx - bx, e1y = cy - by
  const e2x = ax - cx, e2y = ay - cy

  const v0x = px - ax, v0y = py - ay
  const v1x = px - bx, v1y = py - by
  const v2x = px - cx, v2y = py - cy

  const pq0 = Math.max(0, Math.min(1, (v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y)))
  const pq1 = Math.max(0, Math.min(1, (v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y)))
  const pq2 = Math.max(0, Math.min(1, (v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y)))

  const dx0 = v0x - e0x * pq0, dy0 = v0y - e0y * pq0
  const dx1 = v1x - e1x * pq1, dy1 = v1y - e1y * pq1
  const dx2 = v2x - e2x * pq2, dy2 = v2y - e2y * pq2

  const d = Math.min(dx0 * dx0 + dy0 * dy0, dx1 * dx1 + dy1 * dy1, dx2 * dx2 + dy2 * dy2)
  const s = e0x * e2y - e0y * e2x
  const s0 = s * (v0x * e0y - v0y * e0x)
  const s1 = s * (v1x * e1y - v1y * e1x)
  const s2 = s * (v2x * e2y - v2y * e2x)
  const sign = s0 >= 0 && s1 >= 0 && s2 >= 0 ? -1 : 1
  return Math.sqrt(d) * sign
}

/** Smoothly maps a signed distance value to coverage in [0, 1]. */
function smoothAlpha(dist, feather = 1.2) {
  return Math.max(0, Math.min(1, 0.5 - dist / (2 * feather)))
}

/** Linearly interpolates between two RGB channels. */
function mixChannel(a, b, t) {
  return Math.round(a + (b - a) * t)
}

/**
 * Generates a PNG buffer of `size x size` pixels.
 */
function generateIconPngBuffer(size) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  const scale = size / 512
  const aaFeather = Math.max(0.8, 1.2 / scale)

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride
    raw[rowStart] = 0 // Filter type 0 (None)

    // Normalized coordinates in 512x512 design space
    const py = (y + 0.5) / scale

    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4
      const px = (x + 0.5) / scale

      // Outer rounded squircle (leaves crisp transparent margin for OS taskbar/Dock)
      const distOuter = sdRoundedBox(px, py, 256, 256, 224, 224, 100)
      const outerAlpha = smoothAlpha(distOuter, aaFeather)
      if (outerAlpha <= 0) {
        raw[idx] = 0
        raw[idx + 1] = 0
        raw[idx + 2] = 0
        raw[idx + 3] = 0
        continue
      }

      // Base dark obsidian surface (#121216 -> #0b0b0e)
      const tGrad = Math.max(0, Math.min(1, (px * 0.4 + py * 0.6) / 512))
      let r = mixChannel(24, 13, tGrad)
      let g = mixChannel(24, 13, tGrad)
      let b = mixChannel(30, 17, tGrad)

      // Subtle warm inner border ring around outer squircle
      const borderRing = Math.exp(-Math.pow(distOuter + 5, 2) / 18)
      r = mixChannel(r, 232, borderRing * 0.35)
      g = mixChannel(g, 168, borderRing * 0.35)
      b = mixChannel(b, 73, borderRing * 0.35)

      // Center warm gold/amber screen badge (matches Sidebar `#e8a849` -> `#d4893a`)
      const distBadge = sdRoundedBox(px, py, 256, 226, 138, 112, 40)
      const badgeCov = smoothAlpha(distBadge, aaFeather)
      if (badgeCov > 0) {
        const badgeT = Math.max(0, Math.min(1, (py - 114) / 224))
        const br = mixChannel(240, 208, badgeT)
        const bg = mixChannel(176, 130, badgeT)
        const bb = mixChannel(82, 50, badgeT)
        r = mixChannel(r, br, badgeCov)
        g = mixChannel(g, bg, badgeCov)
        b = mixChannel(b, bb, badgeCov)
      }

      // Dark cut-out play triangle inside the gold badge (rounded slightly via negative offset)
      const distPlay = sdTriangle(px, py, 214, 166, 214, 286, 322, 226) - 6
      const playCov = smoothAlpha(distPlay, aaFeather)
      if (playCov > 0) {
        r = mixChannel(r, 15, playCov)
        g = mixChannel(g, 15, playCov)
        b = mixChannel(b, 19, playCov)
      }

      // Bottom download tray / progress pill in warm gold + ivory
      const distTray = sdRoundedBox(px, py, 256, 392, 118, 15, 15)
      const trayCov = smoothAlpha(distTray, aaFeather)
      if (trayCov > 0) {
        // Left 65% of bar filled with warm gold, right 35% muted track
        const fillProgress = smoothAlpha(px - 295, aaFeather * 2)
        const tr = mixChannel(72, 232, fillProgress)
        const tg = mixChannel(72, 168, fillProgress)
        const tb = mixChannel(82, 73, fillProgress)
        r = mixChannel(r, tr, trayCov)
        g = mixChannel(g, tg, trayCov)
        b = mixChannel(b, tb, trayCov)
      }

      raw[idx] = r
      raw[idx + 1] = g
      raw[idx + 2] = b
      raw[idx + 3] = Math.round(outerAlpha * 255)
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // Bit depth
  ihdr[9] = 6 // Color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw, { level: 9 })
  const iend = Buffer.alloc(0)

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', iend)
  ])
}

/**
 * Packs multiple PNG buffers (e.g. 256, 128, 64, 48, 32, 16) into a Windows `.ico` container.
 * Modern Windows (Vista+) natively supports PNG-compressed frames inside `.ico` files.
 */
function buildIcoBuffer(sizes) {
  const frames = sizes.map((sz) => ({
    size: sz,
    png: generateIconPngBuffer(sz)
  }))

  const headerSize = 6
  const dirEntrySize = 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // Reserved
  header.writeUInt16LE(1, 2) // Type 1 = ICO
  header.writeUInt16LE(frames.length, 4) // Image count

  const dirEntries = Buffer.alloc(dirEntrySize * frames.length)
  let dataOffset = headerSize + dirEntries.length

  frames.forEach((frame, idx) => {
    const pos = idx * dirEntrySize
    const dimByte = frame.size >= 256 ? 0 : frame.size
    dirEntries[pos + 0] = dimByte // Width
    dirEntries[pos + 1] = dimByte // Height
    dirEntries[pos + 2] = 0 // Color palette
    dirEntries[pos + 3] = 0 // Reserved
    dirEntries.writeUInt16LE(1, pos + 4) // Color planes
    dirEntries.writeUInt16LE(32, pos + 6) // Bits per pixel
    dirEntries.writeUInt32LE(frame.png.length, pos + 8) // Image byte size
    dirEntries.writeUInt32LE(dataOffset, pos + 12) // Offset in file
    dataOffset += frame.png.length
  })

  return Buffer.concat([header, dirEntries, ...frames.map((f) => f.png)])
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const buildDir = path.resolve(scriptDir, '..', 'build')
const pngPath = path.join(buildDir, 'icon.png')
const icoPath = path.join(buildDir, 'icon.ico')

mkdirSync(buildDir, { recursive: true })

const png512 = generateIconPngBuffer(512)
writeFileSync(pngPath, png512)
console.info(`[generate-icon] Wrote 512x512 PNG (${png512.length} bytes) to ${pngPath}`)

const icoBuffer = buildIcoBuffer([256, 128, 64, 48, 32, 16])
writeFileSync(icoPath, icoBuffer)
console.info(`[generate-icon] Wrote multi-size ICO (${icoBuffer.length} bytes) to ${icoPath}`)

// Ensure macOS .pkg postinstall script uses LF line endings and has 0755 executable permissions.
const macPostinstall = path.resolve(scriptDir, '..', 'installer', 'mac', 'pkg-scripts', 'postinstall')
if (existsSync(macPostinstall)) {
  const normalizedLf = readFileSync(macPostinstall, 'utf-8').replace(/\r\n/g, '\n')
  writeFileSync(macPostinstall, normalizedLf, 'utf-8')
  chmodSync(macPostinstall, 0o755)
  console.info(`[generate-icon] Prepared macOS pkg postinstall script (LF + 0755): ${macPostinstall}`)
}
