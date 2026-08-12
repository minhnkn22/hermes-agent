/**
 * Atum sign-in failure classification — one copy, shared by the full-window
 * auth gate and the (legacy) sidebar entry point so they can never drift into
 * telling the user two different stories about the same error code.
 *
 * The ladder is deliberately ordered: a credential rejection is identified
 * first (it is the only one the user can fix by retyping), then connectivity,
 * then everything else as a provider-side failure.
 */

export type AtumAuthFailureKind = 'credentials' | 'network' | 'provider' | null

export function authFailureKind(errorCode: null | string): AtumAuthFailureKind {
  if (!errorCode) {
    return null
  }

  const code = errorCode.toLowerCase()

  if (
    code.includes('invalid_credentials') ||
    code.includes('invalid_grant') ||
    /password_sign_in_rejected:4\d\d/u.test(code)
  ) {
    return 'credentials'
  }

  if (
    code.includes('network') ||
    code.includes('offline') ||
    code.includes('timeout') ||
    code.includes('unavailable') ||
    code.includes('enotfound')
  ) {
    return 'network'
  }

  return 'provider'
}
