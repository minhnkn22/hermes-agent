import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, test } from 'vitest'

import { resolveAtumPublicAccountConfig } from './public-config'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function configFile(value: unknown, mode = 0o644): string {
  const directory = mkdtempSync(join(tmpdir(), 'atum-public-config-'))
  directories.push(directory)
  const path = join(directory, 'atum-public-config.json')
  writeFileSync(path, JSON.stringify(value))
  chmodSync(path, mode)

  return path
}

const packaged = {
  schemaVersion: 1,
  hostedBaseUrl: 'https://atum-shell-nonprod.vercel.app',
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'packaged-public-key'
}

test('packaged Resources config is the Finder-launch fallback', () => {
  assert.deepEqual(resolveAtumPublicAccountConfig({ environment: {}, packagedPath: configFile(packaged) }), {
    hostedBaseUrl: packaged.hostedBaseUrl,
    supabaseUrl: packaged.supabaseUrl,
    supabaseAnonKey: packaged.supabaseAnonKey
  })
})

test('a complete development environment overrides the package without merging partial values', () => {
  assert.deepEqual(resolveAtumPublicAccountConfig({
    environment: {
      hostedBaseUrl: 'http://127.0.0.1:3000',
      supabaseUrl: 'http://127.0.0.1:55321',
      supabaseAnonKey: 'local-public-key'
    },
    packagedPath: configFile(packaged)
  }), {
    hostedBaseUrl: 'http://127.0.0.1:3000',
    supabaseUrl: 'http://127.0.0.1:55321',
    supabaseAnonKey: 'local-public-key'
  })

  assert.throws(() => resolveAtumPublicAccountConfig({
    environment: { hostedBaseUrl: 'http://127.0.0.1:3000' },
    packagedPath: configFile(packaged)
  }), /incomplete/)
})

test('packaged config rejects unknown fields, world-write access, and excessive bytes', () => {
  assert.throws(() => resolveAtumPublicAccountConfig({
    environment: {},
    packagedPath: configFile({ ...packaged, serviceRoleKey: 'must-not-ship' })
  }), /unknown_field/)
  assert.throws(() => resolveAtumPublicAccountConfig({
    environment: {},
    packagedPath: configFile(packaged, 0o666)
  }), /file_invalid/)
  assert.throws(() => resolveAtumPublicAccountConfig({
    environment: {},
    packagedPath: configFile({ ...packaged, supabaseAnonKey: 'x'.repeat(40_000) })
  }), /file_invalid/)
})
