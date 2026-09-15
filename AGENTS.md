## What this is

A Manifest V3 Chrome DevTools extension (Deno + TypeScript, no framework, no runtime deps) that adds an "mParticle"
panel to DevTools. It shows the events a page sends to mParticle's events API and lets you inspect the page's
`mParticle` SDK instance (forwarders, identity, force upload). See README.md for user-facing behavior.

## Commands

Deno 2.9.6 (pinned in CI). All tasks are in `deno.json`.

```sh
deno task test                    # all tests (jsdom, -A)
deno test -A --filter "events"    # one describe block; --filter matches top-level describe names only, not `it` titles
deno task check                   # deno check src test
deno task lint
deno task fmt                     # single quotes, width 120, HTML excluded
deno fmt --check                  # what CI runs
deno task build                   # bundles src/panel.ts + src/devtools.ts to dist/ and copies html/manifest
```

CI (`test.yml`) runs, in order: `deno fmt --check`, `deno lint`, `deno task check`, `deno task test`, `deno task build`.
Run the same sequence before pushing. Changes under `.github/workflows/` or `.actrc` additionally run actionlint and
`act pull_request` per workflow (`workflows.yml`); `act` is configured via `.actrc`.

Load the extension in Chrome via chrome://extensions → Load unpacked → `dist/`.

## Architecture

Three source files matter:

- `src/devtools.ts` is the devtools page; its only job is `chrome.devtools.panels.create(..., 'panel.html')`.
- `src/panel.html` is the entire UI (tabs, toolbars, all CSS) as static markup. `panel.ts` never creates the
  top-level layout, only list rows.
- `src/panel.ts` is the whole panel logic in one module with no imports. Two data paths:
  1. Network: `chrome.devtools.network.onRequestFinished` → URL filter / hide-forwarding check → `parseBody` →
     if the body is `{events: [...]}`, one `<li>` per event; otherwise one row per request.
  2. Page introspection: `evalWithInstance(body, cb)` wraps `body` in an arrow function receiving `mp` and runs it
     via `chrome.devtools.inspectedWindow.eval`. `mp` resolves from `instanceExpr()`, which picks
     `window.mParticle._instances[<selected>]` (falling back to `window.mParticle` for `default_instance`). The
     Forwarders and Identity tabs, and Force Batch Upload, all go through this. The page-side code lives in the
     `FORWARDERS_EXPR` / `IDENTITY_EXPR` template strings and must be self-contained JS that returns a
     JSON-serializable value (Chrome serializes eval results; functions are stripped).

`loaders` maps tab id → refresh function; `reloadVisible()` re-runs the loader for whichever tab is showing on
navigation and on instance change. Add a new introspection tab by adding a `<section id=X>` in `panel.html`, a
`data-tab="X"` button, and an entry in `loaders`.

## Tests

`test/harness.ts` transpiles `panel.ts` with `@deno/emit`, loads `panel.html` into jsdom, and injects a fake `chrome`
object. `inspectedWindow.eval` is emulated with `node:vm` against a fake `window.mParticle`, and results are
round-tripped through JSON like Chrome does, so eval expressions are exercised for real, not mocked. Use
`loadPanel`, `entry` (HAR-ish request), `fakeMp`, and `fakeUser` from the harness; assert against DOM selectors.
`TZ=UTC` is forced in the harness because `time()` formats in local time.

## Release

`nightly.yml` builds and publishes a `nightly-YYYYMMDD` prerelease zip from `main` daily (skipped if HEAD is already
tagged), keeping the newest 7. `.gitattributes` `export-ignore` controls what is excluded from archives.
