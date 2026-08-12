export type AtumAccountState =
  | 'unconfigured'
  | 'signed_out'
  | 'signing_in'
  | 'signed_in'
  | 'refreshing'
  | 'expired'
  | 'error'

export interface AtumAccountIdentity {
  id: string
  displayName?: string | null
  email?: string | null
}

export interface AtumAccountStatus {
  state: AtumAccountState
  configured: boolean
  account: AtumAccountIdentity | null
  errorCode: string | null
  providers: { google: boolean; password: boolean }
}

export interface AtumAccountClient {
  status(): Promise<AtumAccountStatus>
  signIn(): Promise<AtumAccountStatus>
  /** Password is forwarded once to Electron main; it must never be persisted, logged, or returned. */
  signInWithPassword(credentials: { identifier: string; password: string }): Promise<AtumAccountStatus>
  cancel(): Promise<AtumAccountStatus>
  signOut(): Promise<AtumAccountStatus>
}

const UNCONFIGURED: AtumAccountStatus = {
  state: 'unconfigured',
  configured: false,
  account: null,
  errorCode: null,
  providers: { google: false, password: false }
}

/** Native-account renderer seam. Tokens and PKCE material stay in Electron main. */
export function atumAccountClient(): AtumAccountClient {
  return (
    window.hermesDesktop?.account ?? {
      status: async () => UNCONFIGURED,
      signIn: async () => UNCONFIGURED,
      signInWithPassword: async () => UNCONFIGURED,
      cancel: async () => UNCONFIGURED,
      signOut: async () => UNCONFIGURED
    }
  )
}
