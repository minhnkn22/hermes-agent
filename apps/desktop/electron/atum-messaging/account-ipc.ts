import type { AtumAccountAuthController } from './account-auth'

interface IpcMainLike {
  handle(channel: string, listener: (_event: unknown, ...args: any[]) => unknown): void
  removeHandler?(channel: string): void
}

export const ATUM_ACCOUNT_IPC_CHANNELS = [
  'atum:account:status',
  'atum:account:sign-in',
  'atum:account:cancel',
  'atum:account:sign-out'
] as const

export function registerAtumAccountIpc(ipc: IpcMainLike, controller: AtumAccountAuthController): () => void {
  ipc.handle('atum:account:status', () => controller.status())
  ipc.handle('atum:account:sign-in', () => controller.signIn())
  ipc.handle('atum:account:cancel', () => controller.cancel())
  ipc.handle('atum:account:sign-out', () => controller.signOut())

  return () => {
    for (const channel of ATUM_ACCOUNT_IPC_CHANNELS) {ipc.removeHandler?.(channel)}
  }
}
