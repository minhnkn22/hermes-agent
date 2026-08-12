import fs from 'node:fs'
import path from 'node:path'

import { buildDesktopBackendEnv } from './backend-env'

const BUNDLED_RUNTIME_SCHEMA_VERSION = 1
const BUNDLED_PYTHON_VERSION = '3.11'

interface BundledRuntimeManifest {
  schemaVersion: number
  python?: {
    version?: string
  }
  hermes?: {
    commit?: string
  }
}

interface BundledRuntimeLayout {
  runtimeRoot: string
  pythonRoot: string
  python: string
  sourceRoot: string
  manifestPath: string
}

interface BundledRuntimeDeps {
  fileExists?: (candidate: string) => boolean
  directoryExists?: (candidate: string) => boolean
  readFile?: (candidate: string) => string
  probeRuntime?: (python: string, options: { env: Record<string, string> }) => boolean
}

interface ResolveBundledRuntimeOptions extends BundledRuntimeDeps {
  isPackaged: boolean
  platform?: NodeJS.Platform | string
  resourcesPath?: string
  backendArgs?: string[]
  hermesHome: string
  currentEnv?: NodeJS.ProcessEnv
}

function bundledRuntimeLayout(resourcesPath: string): BundledRuntimeLayout {
  const runtimeRoot = path.join(resourcesPath, 'runtime')
  const pythonRoot = path.join(runtimeRoot, 'python')

  return {
    runtimeRoot,
    pythonRoot,
    python: path.join(pythonRoot, 'bin', 'python3.11'),
    sourceRoot: path.join(runtimeRoot, 'hermes-agent'),
    manifestPath: path.join(runtimeRoot, 'runtime-manifest.json')
  }
}

function readBundledRuntimeManifest(
  manifestPath: string,
  readFile: (candidate: string) => string = candidate => fs.readFileSync(candidate, 'utf8')
): BundledRuntimeManifest | null {
  try {
    const parsed = JSON.parse(readFile(manifestPath))

    if (
      !parsed ||
      parsed.schemaVersion !== BUNDLED_RUNTIME_SCHEMA_VERSION ||
      typeof parsed.python?.version !== 'string' ||
      !parsed.python.version.startsWith(`${BUNDLED_PYTHON_VERSION}.`) ||
      typeof parsed.hermes?.commit !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(parsed.hermes.commit)
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/**
 * Resolve the immutable runtime shipped inside a packaged macOS app.
 *
 * This is intentionally a single validated rung in the existing backend
 * ladder. Missing, malformed, or un-runnable payloads return null so source
 * checkouts and historical bootstrap/install candidates remain available.
 */
function resolveBundledHermesRuntime(options: ResolveBundledRuntimeOptions) {
  const {
    isPackaged,
    platform = process.platform,
    resourcesPath,
    backendArgs = [],
    hermesHome,
    currentEnv = process.env,
    fileExists = fs.existsSync,
    directoryExists = candidate => {
      try {
        return fs.statSync(candidate).isDirectory()
      } catch {
        return false
      }
    },
    readFile,
    probeRuntime
  } = options

  if (!isPackaged || platform !== 'darwin' || !resourcesPath) {
    return null
  }

  const layout = bundledRuntimeLayout(resourcesPath)
  const manifest = readBundledRuntimeManifest(layout.manifestPath, readFile)

  if (!manifest || !fileExists(layout.python) || !directoryExists(layout.sourceRoot)) {
    return null
  }

  const lazyInstallTarget = path.join(hermesHome, 'desktop-runtime', 'lazy-packages')

  const env = {
    ...buildDesktopBackendEnv({
      hermesHome,
      pythonPathEntries: [layout.sourceRoot],
      venvRoot: layout.pythonRoot,
      currentEnv,
      platform
    }),
    // The app bundle is immutable once signed. Hermes' existing durable-target
    // mode keeps optional/lazy plugin dependencies writable without allowing
    // them to shadow the pinned core runtime.
    HERMES_LAZY_INSTALL_TARGET: lazyInstallTarget
  }

  if (!probeRuntime?.(layout.python, { env })) {
    return null
  }

  return {
    kind: 'python',
    label: `bundled Hermes ${manifest.hermes?.commit?.slice(0, 12)} (Python ${manifest.python?.version})`,
    command: layout.python,
    args: ['-m', 'hermes_cli.main', ...backendArgs],
    env,
    root: layout.sourceRoot,
    bootstrap: false,
    shell: false,
    bundled: true,
    runtimeManifest: manifest
  }
}

export {
  BUNDLED_PYTHON_VERSION,
  BUNDLED_RUNTIME_SCHEMA_VERSION,
  bundledRuntimeLayout,
  readBundledRuntimeManifest,
  resolveBundledHermesRuntime
}
