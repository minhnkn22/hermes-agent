#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

export const BUNDLED_PYTHON_VERSION = '3.11.13'
export const BUNDLED_RUNTIME_SCHEMA_VERSION = 1

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const defaultRepoRoot = resolve(desktopRoot, '../..')

const TARGETS = Object.freeze({
  arm64: {
    pythonInstallKey: `cpython-${BUNDLED_PYTHON_VERSION}-macos-aarch64-none`,
    pythonPlatform: 'aarch64-apple-darwin'
  },
  x64: {
    pythonInstallKey: `cpython-${BUNDLED_PYTHON_VERSION}-macos-x86_64-none`,
    pythonPlatform: 'x86_64-apple-darwin'
  }
})

function targetConfig(platform, arch) {
  if (platform !== 'darwin') {
    throw new Error(`bundled runtime currently supports macOS only (got ${platform}-${arch})`)
  }

  const config = TARGETS[arch]

  if (!config) {
    throw new Error(`unsupported macOS bundled-runtime architecture: ${arch}`)
  }

  return config
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: 16 * 1024 * 1024
  })

  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${detail ? `:\n${detail}` : ''}`)
  }

  return options.capture ? String(result.stdout || '').trim() : ''
}

function gitValue(repoRoot, revision) {
  return run('git', ['-C', repoRoot, 'rev-parse', revision], { capture: true })
}

function assertSafeRuntimeTarget(targetRoot) {
  const resolvedTarget = resolve(targetRoot)

  if (resolvedTarget === '/' || !['runtime', 'runtime-test'].includes(resolvedTarget.split('/').at(-1))) {
    throw new Error(`refusing unsafe bundled-runtime target: ${resolvedTarget}`)
  }

  return resolvedTarget
}

function assertCleanPackageSource(status, allowDirty = process.env.ATUM_ALLOW_DIRTY_BUNDLED_RUNTIME === '1') {
  const dirty = String(status || '').trim().length > 0

  if (dirty && !allowDirty) {
    throw new Error(
      'refusing to package a split renderer/backend tree: commit tracked changes first, or set ATUM_ALLOW_DIRTY_BUNDLED_RUNTIME=1 for an explicitly non-reproducible development artifact'
    )
  }

  return dirty
}

function archiveHermesSource({ repoRoot, commit, destination, scratchRoot }) {
  const archivePath = join(scratchRoot, 'hermes-agent.tar')
  mkdirSync(destination, { recursive: true })
  run('git', ['-C', repoRoot, 'archive', '--format=tar', '--output', archivePath, commit])
  run('tar', ['-xf', archivePath, '-C', destination])
  rmSync(archivePath, { force: true })
}

function rewriteInternalAbsoluteSymlinks(root, copiedFrom) {
  let rewritten = 0

  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)

      if (entry.isDirectory()) {
        visit(entryPath)
        continue
      }

      if (!entry.isSymbolicLink()) continue
      const linkTarget = readlinkSync(entryPath)
      if (!isAbsolute(linkTarget)) continue

      const sourcePrefix = `${copiedFrom}${sep}`
      if (linkTarget !== copiedFrom && !linkTarget.startsWith(sourcePrefix)) continue

      const bundledTarget = join(root, relative(copiedFrom, linkTarget))
      const relativeTarget = relative(dirname(entryPath), bundledTarget) || '.'
      unlinkSync(entryPath)
      symlinkSync(relativeTarget, entryPath)
      rewritten += 1
    }
  }

  visit(root)
  return rewritten
}

function removeBytecodeCaches(root) {
  let removed = 0

  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (entry.name === '__pycache__') {
          rmSync(entryPath, { recursive: true, force: true })
          removed += 1
          continue
        }
        visit(entryPath)
        continue
      }

      if (entry.isFile() && (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo'))) {
        rmSync(entryPath, { force: true })
        removed += 1
      }
    }
  }

  visit(root)
  return removed
}

function compileRelocatableBytecode({ pythonRoot }) {
  const python = join(pythonRoot, 'bin', 'python3.11')
  run(python, ['-B', '-m', 'compileall', '--invalidation-mode', 'unchecked-hash', '-q', pythonRoot], {
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1'
    }
  })
}

function installPython({ uv, scratchRoot, destination, pythonInstallKey }) {
  const installRoot = join(scratchRoot, 'python-install')
  run(uv, [
    'python',
    'install',
    pythonInstallKey,
    '--install-dir',
    installRoot,
    '--no-bin',
    '--compile-bytecode',
    '--no-config'
  ])

  const installedRoot = join(installRoot, pythonInstallKey)

  if (!existsSync(join(installedRoot, 'bin', 'python3.11'))) {
    throw new Error(`uv did not produce the expected Python runtime at ${installedRoot}`)
  }

  cpSync(installedRoot, destination, { recursive: true })
  rewriteInternalAbsoluteSymlinks(destination, installedRoot)
  rmSync(installRoot, { recursive: true, force: true })
}

function installLockedDependencies({ uv, repoRoot, scratchRoot, pythonRoot, pythonPlatform }) {
  const requirements = join(scratchRoot, 'requirements.locked.txt')
  const sitePackages = join(pythonRoot, 'lib', 'python3.11', 'site-packages')

  run(
    uv,
    [
      'export',
      '--frozen',
      '--no-dev',
      '--extra',
      'all',
      '--no-emit-project',
      '--format',
      'requirements-txt',
      '--output-file',
      requirements,
      '--no-config'
    ],
    // uv writes the exported requirements to stdout even with --output-file;
    // capture that duplicate stream so package logs remain useful.
    { cwd: repoRoot, capture: true }
  )

  run(uv, [
    'pip',
    'install',
    '--requirements',
    requirements,
    '--require-hashes',
    '--only-binary',
    ':all:',
    '--python-version',
    BUNDLED_PYTHON_VERSION,
    '--python-platform',
    pythonPlatform,
    '--target',
    sitePackages,
    '--compile-bytecode',
    '--no-config'
  ])
}

function probeStagedRuntime({ pythonRoot, sourceRoot, expectedArch }) {
  if (expectedArch !== process.arch) {
    console.warn(
      `[stage-bundled-runtime] staged ${expectedArch} on ${process.arch}; skipping executable probe (package audit must run on target hardware)`
    )
    return
  }

  const python = join(pythonRoot, 'bin', 'python3.11')
  const probe = [
    'import json, platform, sys',
    'import yaml, dotenv, hermes_cli.config',
    "print(json.dumps({'python': platform.python_version(), 'machine': platform.machine(), 'executable': sys.executable}))"
  ].join('; ')

  const output = run(python, ['-B', '-c', probe], {
    capture: true,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: sourceRoot
    }
  })
  const parsed = JSON.parse(output)

  if (!String(parsed.python).startsWith('3.11.')) {
    throw new Error(`staged runtime probe returned unexpected Python ${parsed.python}`)
  }
}

/**
 * Build the immutable payload that is copied to
 * Contents/Resources/runtime before electron-builder signs the app.
 */
export function stageBundledRuntime({
  targetRoot,
  platform = process.platform,
  arch = process.arch,
  repoRoot = defaultRepoRoot,
  uv = process.env.UV || 'uv'
}) {
  const target = assertSafeRuntimeTarget(targetRoot)
  const targetSpec = targetConfig(platform, arch)
  const scratchRoot = `${target}.staging-${process.pid}`
  const pythonRoot = join(scratchRoot, 'python')
  const sourceRoot = join(scratchRoot, 'hermes-agent')
  const commit = gitValue(repoRoot, 'HEAD')
  const tree = gitValue(repoRoot, `${commit}^{tree}`)
  const dirty = assertCleanPackageSource(
    run('git', ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=no'], { capture: true })
  )

  rmSync(scratchRoot, { recursive: true, force: true })
  mkdirSync(scratchRoot, { recursive: true })

  try {
    installPython({
      uv,
      scratchRoot,
      destination: pythonRoot,
      pythonInstallKey: targetSpec.pythonInstallKey
    })
    installLockedDependencies({
      uv,
      repoRoot,
      scratchRoot,
      pythonRoot,
      pythonPlatform: targetSpec.pythonPlatform
    })
    archiveHermesSource({ repoRoot, commit, destination: sourceRoot, scratchRoot })
    // uv compiles bytecode using the temporary staging prefix. Relocating those
    // caches into Atum.app makes Python refresh a small subset on first launch,
    // which mutates the sealed bundle even though the managed backend itself
    // runs with PYTHONDONTWRITEBYTECODE=1. Ship source-only Python modules; the
    // first launch remains cache-free and the app signature stays valid.
    removeBytecodeCaches(pythonRoot)
    probeStagedRuntime({ pythonRoot, sourceRoot, expectedArch: arch })
    // Some Hermes helper processes intentionally sanitize inherited env before
    // re-executing this interpreter. Precompile hash-based bytecode after every
    // source/copy/probe step so those helpers consume sealed, relocation-safe
    // caches instead of creating timestamp caches inside Atum.app.
    compileRelocatableBytecode({ pythonRoot })

    const manifest = {
      schemaVersion: BUNDLED_RUNTIME_SCHEMA_VERSION,
      builtAt: new Date().toISOString(),
      target: { platform, arch },
      python: {
        implementation: 'cpython',
        version: BUNDLED_PYTHON_VERSION,
        installKey: targetSpec.pythonInstallKey,
        build: readFileSync(join(pythonRoot, 'BUILD'), 'utf8').trim()
      },
      hermes: {
        commit,
        tree,
        source: 'git-archive',
        dirtyCheckoutIgnored: dirty
      },
      lock: {
        file: 'uv.lock',
        sha256: sha256File(join(repoRoot, 'uv.lock')),
        profile: 'all-no-dev'
      }
    }

    writeFileSync(join(scratchRoot, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    rmSync(target, { recursive: true, force: true })
    renameSync(scratchRoot, target)
    console.log(
      `[stage-bundled-runtime] staged Python ${BUNDLED_PYTHON_VERSION} + Hermes ${commit.slice(0, 12)} for ${platform}-${arch} at ${target}`
    )
    return manifest
  } catch (error) {
    rmSync(scratchRoot, { recursive: true, force: true })
    throw error
  }
}

export {
  assertCleanPackageSource,
  assertSafeRuntimeTarget,
  compileRelocatableBytecode,
  removeBytecodeCaches,
  rewriteInternalAbsoluteSymlinks,
  targetConfig
}

if (isMain(import.meta.url)) {
  const targetRoot = process.argv[2]

  if (!targetRoot) {
    console.error('Usage: node scripts/stage-bundled-runtime.mjs /absolute/path/to/runtime [arch]')
    process.exit(2)
  }

  stageBundledRuntime({ targetRoot, arch: process.argv[3] || process.arch })
}
