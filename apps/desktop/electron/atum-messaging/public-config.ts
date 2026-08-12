import { readFileSync, statSync } from 'node:fs'

import { type AtumAccountConfig, type AtumAccountConfigInput, resolveAtumAccountConfig } from './account-auth'

const MAX_PUBLIC_CONFIG_BYTES = 32 * 1024

export interface AtumPublicConfigSources {
  environment: AtumAccountConfigInput
  packagedPath?: string | null
}

function parsePackagedPublicConfig(path: string): AtumAccountConfigInput {
  const stat = statSync(path)

  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PUBLIC_CONFIG_BYTES || (stat.mode & 0o002) !== 0) {
    throw new Error('atum_public_config_file_invalid')
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('atum_public_config_invalid')
  }

  const record = parsed as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'hostedBaseUrl', 'supabaseUrl', 'supabaseAnonKey'])

  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw new Error('atum_public_config_contains_unknown_field')
  }

  if (record.schemaVersion !== 1) {
    throw new Error('atum_public_config_schema_unsupported')
  }

  return {
    hostedBaseUrl: typeof record.hostedBaseUrl === 'string' ? record.hostedBaseUrl : null,
    supabaseUrl: typeof record.supabaseUrl === 'string' ? record.supabaseUrl : null,
    supabaseAnonKey: typeof record.supabaseAnonKey === 'string' ? record.supabaseAnonKey : null
  }
}

/** Environment wins as a complete dev override; packages fall back to Resources JSON. */
export function resolveAtumPublicAccountConfig(sources: AtumPublicConfigSources): AtumAccountConfig | null {
  const fromEnvironment = resolveAtumAccountConfig(sources.environment)

  if (fromEnvironment) {return fromEnvironment}

  if (!sources.packagedPath) {return null}

  return resolveAtumAccountConfig(parsePackagedPublicConfig(sources.packagedPath))
}

export { MAX_PUBLIC_CONFIG_BYTES, parsePackagedPublicConfig }
