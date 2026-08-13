#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import PACKAGE_JSON from '../package.json' with { type: 'json' }

const desktopRoot = resolve(import.meta.dirname, '..')
const productName = PACKAGE_JSON.build?.productName || PACKAGE_JSON.productName
const executableName = PACKAGE_JSON.build?.executableName || productName
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const appRoot = join(desktopRoot, 'release', `mac-${arch}`, `${productName}.app`)
const executable = join(appRoot, 'Contents', 'MacOS', executableName)
const timeoutMs = Number(process.env.ATUM_BUNDLED_BOOT_TIMEOUT_MS || 60_000)

if (process.platform !== 'darwin') {
  throw new Error('packaged bundled-runtime verification currently requires macOS')
}
if (!existsSync(executable)) {
  throw new Error(`packaged Atum executable not found: ${executable}`)
}

const sandbox = mkdtempSync(join(tmpdir(), 'atum-bundled-boot-'))
const hermesHome = join(sandbox, 'hermes-home')
const userData = join(sandbox, 'electron-user-data')
const desktopLog = join(hermesHome, 'logs', 'desktop.log')
const env = { ...process.env }

delete env.HERMES_DESKTOP_BOOT_FAKE
delete env.HERMES_DESKTOP_HERMES
delete env.HERMES_DESKTOP_HERMES_ROOT
env.HERMES_DESKTOP_APP_NAME = 'Atum'
env.HERMES_DESKTOP_CWD = sandbox
env.HERMES_DESKTOP_IGNORE_EXISTING = '1'
env.HERMES_DESKTOP_USER_DATA_DIR = userData
env.HERMES_HOME = hermesHome
env.PYTHONDONTWRITEBYTECODE = '1'

const child = spawn(executable, [], { cwd: sandbox, env, stdio: 'ignore' })
const startedAt = Date.now()

function readLog() {
  return existsSync(desktopLog) ? readFileSync(desktopLog, 'utf8') : ''
}

try {
  while (Date.now() - startedAt < timeoutMs) {
    const log = readLog()
    if (log.includes('Using bundled Hermes') && log.includes('Hermes backend is ready. Finalizing desktop startup')) {
      console.log(`ATUM_BUNDLED_BOOT_OK app=${appRoot} home=${hermesHome}`)
      process.exitCode = 0
      break
    }
    if (child.exitCode !== null) {
      throw new Error(`Atum exited before bundled backend readiness (code ${child.exitCode})\n${log.slice(-8000)}`)
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }

  if (process.exitCode !== 0) {
    throw new Error(`timed out waiting for bundled backend readiness\n${readLog().slice(-8000)}`)
  }
} finally {
  child.kill('SIGTERM')
}
