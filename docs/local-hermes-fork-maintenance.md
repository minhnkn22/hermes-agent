# Local Hermes Fork Maintenance

This checkout carries local Atum/Hermes cluster patches on top of upstream
`NousResearch/hermes-agent`.

## Remotes

- `origin`: `https://github.com/minhnkn22/hermes-agent.git`
- `upstream`: `git@github.com:NousResearch/hermes-agent.git`

`upstream` push is intentionally disabled locally so agents do not accidentally
try to publish to the upstream project.

## Active Local Patch Branch

Current branch:

```bash
chore/claude-sidecar-fable-alias
```

Important local commits include:

- Claude sidecar alias support, including `fable`.
- Profile-scoped Desktop messaging settings.
- Multi-profile Desktop sidebar uses profiles as top-level agents and nests all
  session transports beneath the owning agent.

## Updating From Upstream

Use rebase for the local patch branch unless a merge commit is intentionally
wanted for conflict archaeology:

```bash
git fetch upstream --prune
git checkout chore/claude-sidecar-fable-alias
git rebase upstream/main
```

If conflicts occur, resolve them, then continue:

```bash
git status
git add <resolved-files>
git rebase --continue
```

After a successful rebase, verify and rebuild Desktop:

```bash
cd apps/desktop
npm run typecheck -- --pretty false
npm run test -- src/store/profile-scope.test.ts src/app/chat/sidebar/session-row.test.tsx src/app/session/hooks/use-session-list-actions.test.tsx src/hermes.test.ts src/hermes-profile-scope.test.ts
npm run pack
```

Then publish the rebased branch to the fork:

```bash
git push --force-with-lease origin chore/claude-sidecar-fable-alias
```

Use `--force-with-lease` only for this owned feature branch after a rebase.
Never force-push `main`.

## Rebuilding The Local Desktop App

After local source changes or an upstream rebase:

```bash
cd apps/desktop
npm run pack
open /Users/nmmacmini/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app
```

If Desktop is already running, quit it first or restart only the Desktop app.
Do not restart the profile-local Telegram gateways unless gateway code or
profile configuration changed.
