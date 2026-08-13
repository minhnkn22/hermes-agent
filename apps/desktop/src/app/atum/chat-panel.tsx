import { WiredPane } from '@/app/contrib/context'

/**
 * The chat plate — the product centre, and the only plate that carries
 * `--atum-shadow-chat`.
 *
 * Conversation identity and the compact roster toggle live in the thin rim;
 * everything
 * the Hermes titlebar used to stack (model pill, approval-mode menu, context
 * usage, gateway menu, session dropdown, pin, split, flip, haptics, keybinds,
 * settings gear, sidebar toggles) lives in the account menu, Settings, and the
 * ⌘K palette, which stay registered.
 *
 * The BODY is `WiredPane part="chatRoutes"` — the same assistant-ui transcript,
 * tool cards, approvals, and DM view the Hermes shell renders. There is exactly
 * one transcript renderer in this app and this is not a second one.
 */
export function AtumChatPanel() {
  return (
    <section className="atum-plate-chat relative flex min-w-0 flex-1 flex-col overflow-hidden [-webkit-app-region:no-drag]">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <WiredPane part="chatRoutes" />
      </div>
    </section>
  )
}
