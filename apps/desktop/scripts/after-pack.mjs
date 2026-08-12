/**
 * after-pack.mjs — electron-builder afterPack hook.
 *
 * Final target-specific package staging:
 *
 * - macOS gets the pinned, relocatable Python + Hermes payload under
 *   Contents/Resources/runtime before electron-builder signs the bundle.
 * - Windows gets its Hermes icon + identity stamped via rcedit. That cosmetic
 *   stamp remains best-effort; runtime staging fails closed because omitting it
 *   would produce an app that cannot start on a clean Mac.
 *
 * electron-builder passes a context with:
 *   - electronPlatformName: 'win32' | 'darwin' | 'linux'
 *   - appOutDir:            the unpacked app directory for this target
 *   - packager.appInfo.productFilename: the exe basename (e.g. 'Hermes')
 */

import path from 'node:path'
import { Arch } from 'electron-builder'

import { stampExeIdentity } from './set-exe-identity.mjs'
import { stageBundledRuntime } from './stage-bundled-runtime.mjs'

export default async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') {
    const productName = context.packager?.appInfo?.productFilename || 'Hermes'
    const arch = typeof context.arch === 'number' ? Arch[context.arch] : process.arch
    const runtimeRoot = path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources', 'runtime')

    stageBundledRuntime({ targetRoot: runtimeRoot, platform: 'darwin', arch })
    return
  }

  if (context.electronPlatformName !== 'win32') {
    return
  }

  const productName = context.packager?.appInfo?.productFilename || 'Hermes'
  const exe = path.join(context.appOutDir, `${productName}.exe`)
  const desktopRoot = path.resolve(import.meta.dirname, '..')

  try {
    await stampExeIdentity(exe, desktopRoot)
  } catch (err) {
    // Never fail the build over a cosmetic stamp.
    console.warn(`[after-pack] exe identity stamp failed (${err.message}); Hermes.exe keeps the stock Electron icon`)
  }
}
