import { describe, expect, it } from 'vitest'

import { appViewForPath, dmRoute, routeDmConversationId, routeSessionId } from './routes'

describe('Atum direct-message routes', () => {
  it('round-trips an opaque conversation id through the explicit DM prefix', () => {
    expect(dmRoute('room / một')).toBe('/dm/room%20%2F%20m%E1%BB%99t')
    expect(routeDmConversationId('/dm/room%20%2F%20m%E1%BB%99t')).toBe('room / một')
  })

  it('never treats a DM as a Hermes assistant session', () => {
    expect(routeSessionId('/dm/conversation-1')).toBeNull()
    expect(appViewForPath('/dm/conversation-1')).toBe('dm')
  })

  it('rejects missing and nested DM identifiers', () => {
    expect(routeDmConversationId('/dm/')).toBeNull()
    expect(routeDmConversationId('/dm/one/two')).toBeNull()
  })
})
