import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  assertCleanPackageSource,
  assertSafeRuntimeTarget,
  BUNDLED_PYTHON_VERSION,
  targetConfig
} from './stage-bundled-runtime.mjs'

test('runtime target matrix pins CPython 3.11 for both supported Mac architectures', () => {
  assert.deepEqual(targetConfig('darwin', 'arm64'), {
    pythonInstallKey: `cpython-${BUNDLED_PYTHON_VERSION}-macos-aarch64-none`,
    pythonPlatform: 'aarch64-apple-darwin'
  })
  assert.deepEqual(targetConfig('darwin', 'x64'), {
    pythonInstallKey: `cpython-${BUNDLED_PYTHON_VERSION}-macos-x86_64-none`,
    pythonPlatform: 'x86_64-apple-darwin'
  })
})

test('unsupported platform or architecture fails closed before staging', () => {
  assert.throws(() => targetConfig('linux', 'x64'), /supports macOS only/)
  assert.throws(() => targetConfig('darwin', 'universal'), /unsupported macOS/)
})

test('staging cleanup is constrained to an explicitly named runtime build directory', () => {
  const target = path.join(os.tmpdir(), 'Atum.app', 'Contents', 'Resources', 'runtime')
  assert.equal(assertSafeRuntimeTarget(target), path.resolve(target))
  assert.throws(() => assertSafeRuntimeTarget('/'), /refusing unsafe/)
  assert.throws(() => assertSafeRuntimeTarget(os.tmpdir()), /refusing unsafe/)
})

test('packaging refuses tracked dirty state unless the development override is explicit', () => {
  assert.equal(assertCleanPackageSource('', false), false)
  assert.throws(() => assertCleanPackageSource(' M apps/desktop/electron/main.ts', false), /split renderer\/backend tree/)
  assert.equal(assertCleanPackageSource(' M apps/desktop/electron/main.ts', true), true)
})
