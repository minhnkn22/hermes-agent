import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { decodePngToRgba, isFullyOpaque, parseIcns } from './mac-icon.mjs'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8')
const readBuffer = relativePath => fs.readFileSync(path.join(desktopRoot, relativePath))
const packageJson = JSON.parse(read('package.json'))

test('packaged macOS identity is Atum while Hermes protocol compatibility remains stable', () => {
  assert.equal(packageJson.name, 'hermes')
  assert.equal(packageJson.productName, 'Atum')
  assert.equal(packageJson.build.appId, 'com.atum.desktop')
  assert.equal(packageJson.build.productName, 'Atum')
  assert.equal(packageJson.build.executableName, 'Atum')
  assert.equal(packageJson.build.mac.icon, 'assets/icon-mac.icns')
  assert.deepEqual(packageJson.build.protocols[0].schemes, ['hermes'])
})

test('Atum macOS icon source is a full-bleed opaque 1024 canvas (no transparent inset)', () => {
  const svg = read('assets/icon-mac.svg')

  assert.match(svg, /viewBox="0 0 1024 1024"/)
  // Full-bleed background: a 1024x1024 rect covering the whole canvas. The
  // previous 824px inset body (x=100 y=100 rx=185) left the corners
  // transparent, and current macOS wraps that artwork in a legacy white
  // container tile — the exact user-visible defect this guards.
  assert.match(svg, /<rect width="1024" height="1024" fill=/)
  assert.doesNotMatch(svg, /<rect x="100" y="100"/)
})

test('icon-mac.icns carries the SAME 1024 pixels as icon-mac.png, fully opaque', () => {
  // Content correspondence, not size: the icns 1024px entry must decode to
  // exactly the pixels of icon-mac.png, and every pixel must be opaque so the
  // OS never composites a container tile behind transparent corners.
  const pngPixels = decodePngToRgba(readBuffer('assets/icon-mac.png'))

  assert.equal(pngPixels.width, 1024)
  assert.equal(pngPixels.height, 1024)

  const entries = parseIcns(readBuffer('assets/icon-mac.icns'))
  const largest = entries.get('ic10')

  assert.ok(largest, 'icns must contain a 1024px (ic10) entry')

  const icnsPixels = decodePngToRgba(largest)

  assert.equal(icnsPixels.width, 1024)
  assert.equal(icnsPixels.height, 1024)
  assert.deepEqual(
    icnsPixels.data,
    pngPixels.data,
    'icns 1024 entry drifted from icon-mac.png — run: node scripts/generate-mac-icon.mjs'
  )
  assert.ok(isFullyOpaque(pngPixels), 'icon-mac.png must be fully opaque (full-bleed, no transparent corners)')
})

test('window title and native fallback name are Atum', () => {
  assert.match(read('index.html'), /<title>Atum<\/title>/)
  assert.match(read('electron/main.ts'), /HERMES_DESKTOP_APP_NAME \|\| 'Atum'/)
})

test('Windows installer and uninstall lifecycle derive or recognize the Atum product identity', () => {
  const installPs1 = fs.readFileSync(path.resolve(desktopRoot, '..', '..', 'scripts', 'install.ps1'), 'utf8')
  const guiUninstall = fs.readFileSync(path.resolve(desktopRoot, '..', '..', 'hermes_cli', 'gui_uninstall.py'), 'utf8')

  assert.match(installPs1, /desktopPackage\.build\.executableName/)
  assert.match(installPs1, /\$desktopExecutableName, "Hermes"/)
  assert.match(installPs1, /"\$ProductName\.lnk"/)
  assert.match(guiUninstall, /Applications\/Atum\.app/)
  assert.match(guiUninstall, /Programs" \/ "Atum"/)
})
