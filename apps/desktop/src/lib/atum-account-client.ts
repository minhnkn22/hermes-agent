export type AtumAccountAuthState =
  | 'unconfigured'
  | 'signed_out'
  | 'signing_in'
  | 'signed_in'
  | 'refreshing'
  | 'expired'
  | 'error'

export interface AtumAccountAuthStatus {
  state: AtumAccountAuthState
  configured: boolean
  account: { id: string; displayName: string | null; handle: string | null } | null
  errorCode: string | null
  providers: { google: boolean; password: boolean }
}

export interface AtumAccountClient {
  status(): Promise<AtumAccountAuthStatus>
  signIn(): Promise<AtumAccountAuthStatus>
  signInWithPassword(input: { identifier: string; password: string }): Promise<AtumAccountAuthStatus>
  cancel(): Promise<AtumAccountAuthStatus>
  signOut(): Promise<AtumAccountAuthStatus>
}
