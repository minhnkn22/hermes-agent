import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PUBLIC_CONFIG_FIELDS = {
  hostedBaseUrl: 'ATUM_PUBLIC_HOSTED_BASE_URL',
  supabaseUrl: 'ATUM_PUBLIC_SUPABASE_URL',
  supabaseAnonKey: 'ATUM_PUBLIC_SUPABASE_ANON_KEY'
}

export function publicConfigFromEnvironment(environment) {
  const config = {
    schemaVersion: 1,
    providers: {
      google: environment.ATUM_PUBLIC_GOOGLE_AUTH_ENABLED === 'true',
      password: environment.ATUM_PUBLIC_PASSWORD_AUTH_ENABLED !== 'false'
    }
  }

  for (const [field, variable] of Object.entries(PUBLIC_CONFIG_FIELDS)) {
    const value = environment[variable]

    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing build-time public config variable ${variable}`)
    }

    config[field] = value.trim()
  }

  return config
}

export function writeAtumPublicConfig({ environment = process.env, outputPath }) {
  const config = publicConfigFromEnvironment(environment)
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(config)}\n`, { mode: 0o644 })
  return outputPath
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invoked) {
  const outputPath = process.argv[2]

  if (!outputPath) throw new Error('Usage: write-atum-public-config.mjs <output-path>')
  writeAtumPublicConfig({ outputPath })
}
