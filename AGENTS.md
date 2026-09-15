## What this is

A Manifest V3 Chrome DevTools extension (Deno + TypeScript, no framework, no runtime deps) that adds an "mParticle"
panel to DevTools. It shows the events a page sends to mParticle's events API and lets you inspect the page's
`mParticle` SDK instance (forwarders, identity, force upload). See README.md for user-facing behavior.

## Commands

Deno 2.9.6 (pinned in CI). All tasks are in `deno.json`.

```sh
deno task test                    # all tests (jsdom, -A)
deno test -A --filter "events"    # one describe block; --filter matches top-level describe names only, not `it` titles
deno task check                   # deno check src test e2e
deno task lint
deno task fmt                     # single quotes, width 120, HTML excluded
deno fmt --check                  # what CI runs
deno task build                   # bundles src/panel.ts + src/devtools.ts to dist/ and copies html/manifest
deno task e2e                     # builds dist/, launches system Chrome headful, visits live sites (see Tests)
```

CI (`test.yml`) runs, in order: `deno fmt --check`, `deno lint`, `deno task check`, `deno task test`, `deno task build`.
Run the same sequence before pushing. Changes under `.github/workflows/` or `.actrc` additionally run actionlint and
`act pull_request` per workflow (`workflows.yml`); `act` is configured via `.actrc`. `release.yml` and `nightly.yml`
call `test.yml` as a prerequisite job, so nothing is tagged or published unless it passes.

Load the extension in Chrome via chrome://extensions → Load unpacked → `dist/`.

## Architecture

Domain terms (Instance, Probe, Forwarder, Identity, Batch) are defined in `CONTEXT.md`. Four source files matter:

- `src/devtools.ts` is the devtools page; its only job is `chrome.devtools.panels.create(..., 'panel.html')`.
- `src/panel.html` is the entire UI (tabs, toolbars, all CSS) as static markup. `panel.ts` never creates the top-level
  layout, only list rows.
- `src/probes.ts` holds the page-side code: the `MpInstance` type (every member optional, since the page can run any SDK
  version) and the probes `probeForwarders`, `probeIdentity`, `probeUpload`, each a plain exported function
  `(mp?: MpInstance) => T | { error }`. The file must contain only types and exported function declarations, no
  module-level values and no value imports, because a probe is shipped to the page as `String(fn)` and any free
  identifier is a ReferenceError there (and fails the tests, which run probes in a bare `vm` context).
- `src/panel.ts` is the panel logic; its only import is `./probes.ts`. Two data paths:
  1. Network: `chrome.devtools.network.onRequestFinished` → URL filter / hide-forwarding check → `parseBody` → if the
     body is `{events: [...]}`, one `<li>` per event; otherwise one row per request.
  2. Page introspection: `probe(fn, cb)` evaluates `(${String(fn)})(${instanceExpr()})` via
     `chrome.devtools.inspectedWindow.eval`. `instanceExpr()` picks `window.mParticle._instances[<selected>]` (falling
     back to `window.mParticle` for `default_instance`). An eval exception is folded into
     `{ error: 'eval failed: ...' }`, so callbacks see one shape: the probe's return value or `{ error }`. Probe results
     must be JSON-serializable (Chrome serializes eval results; functions are stripped). The instance dropdown
     (`loadInstances`) is the one remaining raw eval string; it reads `window.mParticle`, not an instance.

`loaders` maps tab id → refresh function; `reloadVisible()` re-runs the loader for whichever tab is showing on
navigation and on instance change. Add a new introspection tab by adding a `<section id=X>` in `panel.html`, a
`data-tab="X"` button, a probe in `probes.ts`, a loader that calls `probe(theProbe, render)`, and an entry in `loaders`.

## Tests

`test/harness.ts` bundles `panel.ts` (and its `probes.ts` import) into one plain script with `@deno/emit`, loads
`panel.html` into jsdom, and injects a fake `chrome` object. `inspectedWindow.eval` is emulated with `node:vm` against a
fake `window.mParticle`, and results are round-tripped through JSON like Chrome does, so probes are exercised for real,
not mocked. Use `loadPanel`, `entry` (HAR-ish request), `fakeMp`, and `fakeUser` from the harness; assert against DOM
selectors. `TZ=UTC` is forced in the harness because `time()` formats in local time.

`e2e/mparticle.e2e.ts` is the opt-in end-to-end test. It launches system Chrome (`puppeteer-core`, `channel: 'chrome'`,
headful because `devtools: true` forces it) with `dist/` loaded and visits each entry in its `SITES` array. For a site
flagged `mparticle: true` (www.mparticle.com) it asserts in two fail-fast stages: captured requests matching the panel's
default filter render rows when replayed through `test/harness.ts`, then the real DevTools panel shows rows after a
reload. Both stages fall back to a forced upload, because the SDK only sends a batch on a 10s timer, on `upload()`, or
after a commerce event. A site flagged `mparticle: false` (www.google.com) is a control: no matching requests, empty
panel, count `0`. Gotchas baked into the file: `pipe: true` is required with `enableExtensions`; the panel target
rejects `asPage()`, so its DOM is read via a raw CDP session; cookies and storage are cleared before the reload or the
SDK's cached identity sends nothing. It needs Chrome and network, so `deno task test` does not run it (the filename
avoids `*.test.ts`) and neither does PR CI; `e2e.yml` runs it on manual dispatch and a nightly schedule under
`xvfb-run`.

## Release

`nightly.yml` builds and publishes a `vX.Y.Z-nightly.YYYYMMDD` prerelease zip from `main` daily (skipped if HEAD is
already tagged), keeping the newest 7. `release.yml` (manual, `channel` input) tags `main` as `vX.Y.Z` (release) or
`vX.Y.Z-beta.N` (prerelease) using the version in `src/manifest.json`. `.gitattributes` `export-ignore` controls what is
excluded from archives.
