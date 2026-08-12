import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  assertCleanPackageSource,
  assertSafeRuntimeTarget,
  BUNDLED_PYTHON_VERSION,
  removeBytecodeCaches,
  rewriteInternalAbsoluteSymlinks,
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
  assert.throws(
    () => assertCleanPackageSource(' M apps/desktop/electron/main.ts', false),
    /split renderer\/backend tree/
  )
  assert.equal(assertCleanPackageSource(' M apps/desktop/electron/main.ts', true), true)
})

test('copied Python aliases are rewritten from staging absolutes to relocatable links', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'atum-runtime-links-'))
  const installedRoot = path.join(scratch, 'python-install', 'cpython-test')
  const bundledRoot = path.join(scratch, 'runtime-test')
  fs.mkdirSync(path.join(installedRoot, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(bundledRoot, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(installedRoot, 'bin', 'python3.11'), 'python')
  fs.copyFileSync(path.join(installedRoot, 'bin', 'python3.11'), path.join(bundledRoot, 'bin', 'python3.11'))
  fs.symlinkSync(path.join(installedRoot, 'bin', 'python3.11'), path.join(bundledRoot, 'bin', 'python3'))

  assert.equal(rewriteInternalAbsoluteSymlinks(bundledRoot, installedRoot), 1)
  assert.equal(fs.readlinkSync(path.join(bundledRoot, 'bin', 'python3')), 'python3.11')
  fs.rmSync(path.join(scratch, 'python-install'), { recursive: true })
  assert.equal(
    fs.realpathSync(path.join(bundledRoot, 'bin', 'python3')),
    fs.realpathSync(path.join(bundledRoot, 'bin', 'python3.11'))
  )
  fs.rmSync(scratch, { recursive: true })
})

test('packaged runtime removes relocatable bytecode caches before signing', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'atum-runtime-bytecode-'))
  fs.mkdirSync(path.join(scratch, 'lib', '__pycache__'), { recursive: true })
  fs.mkdirSync(path.join(scratch, 'site-packages'), { recursive: true })
  fs.writeFileSync(path.join(scratch, 'lib', '__pycache__', 'argparse.cpython-311.pyc'), 'compiled')
  fs.writeFileSync(path.join(scratch, 'site-packages', 'legacy.pyo'), 'compiled')
  fs.writeFileSync(path.join(scratch, 'site-packages', 'module.py'), 'source')

  assert.equal(removeBytecodeCaches(scratch), 2)
  assert.equal(fs.existsSync(path.join(scratch, 'lib', '__pycache__')), false)
  assert.equal(fs.existsSync(path.join(scratch, 'site-packages', 'legacy.pyo')), false)
  assert.equal(fs.readFileSync(path.join(scratch, 'site-packages', 'module.py'), 'utf8'), 'source')
  fs.rmSync(scratch, { recursive: true })
})
