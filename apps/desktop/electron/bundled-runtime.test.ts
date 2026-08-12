import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import {
  BUNDLED_RUNTIME_SCHEMA_VERSION,
  bundledRuntimeLayout,
  readBundledRuntimeManifest,
  resolveBundledHermesRuntime
} from './bundled-runtime'

const COMMIT = '6c5a1009fd8ee0a92dfa08ee35b65ae1f4bdfd1b'

function manifest(overrides = {}) {
  return JSON.stringify({
    schemaVersion: BUNDLED_RUNTIME_SCHEMA_VERSION,
    python: { version: '3.11.13' },
    hermes: { commit: COMMIT },
    ...overrides
  })
}

test('bundled runtime is the packaged macOS backend when its real launch seam validates', () => {
  const resourcesPath = '/Applications/Atum.app/Contents/Resources'
  const layout = bundledRuntimeLayout(resourcesPath)
  const probes = []

  const backend = resolveBundledHermesRuntime({
    isPackaged: true,
    platform: 'darwin',
    resourcesPath,
    backendArgs: ['serve', '--isolated'],
    hermesHome: '/Users/minh/.hermes',
    currentEnv: { PATH: '/usr/bin:/bin' },
    fileExists: candidate => candidate === layout.python,
    directoryExists: candidate => candidate === layout.sourceRoot,
    readFile: candidate => {
      assert.equal(candidate, layout.manifestPath)

      return manifest()
    },
    probeRuntime: (python, options) => {
      probes.push({ python, env: options.env })

      return true
    }
  })

  assert.equal(backend?.command, layout.python)
  assert.deepEqual(backend?.args, ['-B', '-m', 'hermes_cli.main', 'serve', '--isolated'])
  assert.equal(backend?.root, layout.sourceRoot)
  assert.equal(backend?.bootstrap, false)
  assert.equal(backend?.bundled, true)
  assert.equal(backend?.runtimeManifest.hermes.commit, COMMIT)
  assert.equal(probes.length, 1)
  assert.equal(probes[0].python, layout.python)
  assert.equal(probes[0].env.PYTHONPATH, layout.sourceRoot)
  assert.ok(probes[0].env.PATH.split(':').includes(`${layout.pythonRoot}/bin`))
  assert.equal(probes[0].env.HERMES_LAZY_INSTALL_TARGET, '/Users/minh/.hermes/desktop-runtime/lazy-packages')
})

test('bundled runtime is never selected for dev or non-macOS builds', () => {
  const common = {
    resourcesPath: '/resources',
    hermesHome: '/home/user/.hermes',
    fileExists: () => true,
    directoryExists: () => true,
    readFile: () => manifest(),
    probeRuntime: () => true
  }

  assert.equal(resolveBundledHermesRuntime({ ...common, isPackaged: false, platform: 'darwin' }), null)
  assert.equal(resolveBundledHermesRuntime({ ...common, isPackaged: true, platform: 'linux' }), null)
})

test('invalid payloads fall through without weakening the existing resolver ladder', () => {
  const resourcesPath = '/resources'
  const layout = bundledRuntimeLayout(resourcesPath)

  const common = {
    isPackaged: true,
    platform: 'darwin',
    resourcesPath,
    hermesHome: '/Users/minh/.hermes',
    directoryExists: candidate => candidate === layout.sourceRoot,
    probeRuntime: () => true
  }

  assert.equal(resolveBundledHermesRuntime({ ...common, fileExists: () => false, readFile: () => manifest() }), null)
  assert.equal(resolveBundledHermesRuntime({ ...common, fileExists: () => true, readFile: () => '{bad json' }), null)
  assert.equal(
    resolveBundledHermesRuntime({
      ...common,
      fileExists: () => true,
      readFile: () => manifest(),
      probeRuntime: () => false
    }),
    null
  )
})

test('manifest contract pins Python 3.11 and an exact Hermes commit', () => {
  assert.equal(readBundledRuntimeManifest('/manifest', () => manifest())?.hermes?.commit, COMMIT)
  assert.equal(
    readBundledRuntimeManifest('/manifest', () => manifest({ python: { version: '3.12.1' } })),
    null
  )
  assert.equal(
    readBundledRuntimeManifest('/manifest', () => manifest({ hermes: { commit: 'main' } })),
    null
  )
})

test('runtime layout remains relocatable under the Electron resources directory', () => {
  const resources = path.join('/Volumes', 'Atum Test', 'Atum.app', 'Contents', 'Resources')
  const layout = bundledRuntimeLayout(resources)

  assert.equal(layout.runtimeRoot, path.join(resources, 'runtime'))
  assert.equal(layout.python, path.join(resources, 'runtime', 'python', 'bin', 'python3.11'))
  assert.equal(layout.sourceRoot, path.join(resources, 'runtime', 'hermes-agent'))
})
