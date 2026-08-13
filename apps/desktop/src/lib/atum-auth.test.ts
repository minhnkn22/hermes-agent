import { describe, expect, it } from 'vitest'

import { authFailureKind } from './atum-auth'

describe('authFailureKind', () => {
  it('has no opinion without an error code', () => {
    expect(authFailureKind(null)).toBeNull()
    expect(authFailureKind('')).toBeNull()
  })

  it.each(['invalid_credentials', 'INVALID_GRANT', 'password_sign_in_rejected:400', 'password_sign_in_rejected:401'])(
    'classifies %s as a credential problem the user can fix',
    code => {
      expect(authFailureKind(code)).toBe('credentials')
    }
  )

  it.each(['password_sign_in_timeout', 'network_error', 'offline', 'service_unavailable', 'ENOTFOUND'])(
    'classifies %s as connectivity',
    code => {
      expect(authFailureKind(code)).toBe('network')
    }
  )

  it('treats a 5xx rejection as provider-side, not as bad credentials', () => {
    expect(authFailureKind('password_sign_in_rejected:500')).toBe('provider')
  })

  it('falls back to provider for anything unrecognised', () => {
    expect(authFailureKind('provider_not_configured')).toBe('provider')
  })
})
