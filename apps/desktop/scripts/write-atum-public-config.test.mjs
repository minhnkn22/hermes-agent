import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import { publicConfigFromEnvironment, writeAtumPublicConfig } from './write-atum-public-config.mjs'

const environment = {
  ATUM_PUBLIC_HOSTED_BASE_URL: 'https://atum-shell-nonprod.vercel.app',
  ATUM_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  ATUM_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'must-not-ship',
  ATUM_APP_SERVICE_CREDENTIALS: 'must-not-ship',
  CRON_SECRET: 'must-not-ship'
}

test('build config generator emits only the three allowlisted public fields', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'atum-public-config-script-'))
  const outputPath = path.join(directory, 'atum-public-config.json')

  try {
    writeAtumPublicConfig({ environment, outputPath })
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), {
      schemaVersion: 1,
      hostedBaseUrl: environment.ATUM_PUBLIC_HOSTED_BASE_URL,
      supabaseUrl: environment.ATUM_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: environment.ATUM_PUBLIC_SUPABASE_ANON_KEY
    })
    assert.doesNotMatch(readFileSync(outputPath, 'utf8'), /service|credential|cron|must-not-ship/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('generator fails closed rather than creating a partial config', () => {
  assert.throws(() => publicConfigFromEnvironment({
    ATUM_PUBLIC_HOSTED_BASE_URL: environment.ATUM_PUBLIC_HOSTED_BASE_URL,
    ATUM_PUBLIC_SUPABASE_URL: environment.ATUM_PUBLIC_SUPABASE_URL
  }), /ATUM_PUBLIC_SUPABASE_ANON_KEY/)
})
