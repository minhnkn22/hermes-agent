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
}

export interface AtumAccountClient {
  status(): Promise<AtumAccountAuthStatus>
  signIn(): Promise<AtumAccountAuthStatus>
  cancel(): Promise<AtumAccountAuthStatus>
  signOut(): Promise<AtumAccountAuthStatus>
}
