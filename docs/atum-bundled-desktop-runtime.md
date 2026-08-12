# Atum macOS bundled Hermes runtime

Atum's private-dogfood macOS distribution ships Hermes Desktop with its Python
backend in the same `.app`. A clean Mac does not need Homebrew, `uv`, a prior
Hermes checkout, or the first-launch source bootstrap before the local agent can
start.

## Packaged layout

`electron-builder` runs `apps/desktop/scripts/stage-bundled-runtime.mjs` from
the macOS `afterPack` hook, before signing. The result is:

```text
Atum.app/Contents/Resources/runtime/
├── python/                 # relocatable CPython 3.11.13 distribution
├── hermes-agent/           # exact `git archive` of the build commit
└── runtime-manifest.json   # Python, commit/tree, target, and uv.lock digest
```

The source archive is mechanical and commit-addressed. It deliberately keeps
the whole tracked Hermes tree, including built-in and optional skills, plugins,
model providers, browser/computer tools, messaging gateways, and cron support.
Dependencies are exported from the committed `uv.lock` with the `all` profile,
installed from hash-verified wheels, and probed through the same imports used by
the real Desktop launch path.

Optional providers that Hermes installs lazily are redirected to
`$HERMES_HOME/desktop-runtime/lazy-packages`. This uses Hermes' existing durable
target mode: the signed app stays immutable, the pinned core remains first on
`sys.path`, and optional packages remain user-writable.

## Resolver precedence

The desktop resolver keeps its existing fallbacks. Its relevant order is:

1. explicit developer source override;
2. development checkout when the app is not packaged;
3. validated bundled runtime for a packaged macOS app;
4. historical managed install, existing CLI, system module, then bootstrap.

The bundled candidate is trusted only when the manifest is valid, the expected
files exist, and its Python can import Hermes' launch dependencies with the
archived source on `PYTHONPATH`. A damaged or absent payload falls through; it
does not remove repair/development compatibility.

## Build and verification

For the current Mac architecture:

```bash
cd apps/desktop
npm run runtime:stage
build/runtime-test/python/bin/python3.11 -c \
  'import yaml, dotenv, hermes_cli.config; print("runtime ok")'
```

`npm run pack` stages the runtime directly into the unpacked `.app`. Inspect
`Contents/Resources/runtime/runtime-manifest.json`, then launch the packaged app
on a clean Mac of the same architecture. Cross-architecture staging is
supported for arm64 and x64, but the executable seam probe is intentionally
deferred to matching target hardware.

## Distribution limit

The runtime contains native executables, dynamic libraries, and Python extension
modules. A local unsigned/ad-hoc package can be tested on the build Mac, but a
public build still needs a valid Apple Developer ID so the complete nested
runtime is signed and the app can be notarized. The bundling work does not
pretend to replace that distribution credential.
