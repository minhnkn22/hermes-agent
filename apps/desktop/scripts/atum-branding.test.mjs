import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8')
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

test('Atum macOS icon has a transparent 1024 canvas and conventional inset body', () => {
  const svg = read('assets/icon-mac.svg')

  assert.match(svg, /viewBox="0 0 1024 1024"/)
  assert.match(svg, /<rect x="100" y="100" width="824" height="824" rx="185"/)
  assert.ok(fs.statSync(path.join(desktopRoot, 'assets/icon-mac.icns')).size > 100_000)
  assert.ok(fs.statSync(path.join(desktopRoot, 'assets/icon-mac.png')).size > 10_000)
})

test('window title and native fallback name are Atum', () => {
  assert.match(read('index.html'), /<title>Atum<\/title>/)
  assert.match(read('electron/main.ts'), /HERMES_DESKTOP_APP_NAME \|\| 'Atum'/)
})
