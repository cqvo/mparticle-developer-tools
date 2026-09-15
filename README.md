# mParticle Developer Tools

Chrome DevTools extension that lists the network requests a page sends to mParticle's events API.

## Quickstart

### Installing from a release

1. Download `mparticle-developer-tools.zip` from the latest
   [release](https://github.com/cqvo/mparticle-developer-tools/releases). Production releases are tagged `vX.Y.Z`, betas
   are `vX.Y.Z-beta.N` prereleases, and `vX.Y.Z-nightly.YYYYMMDD` prereleases are built from `main` daily.
2. Unzip it.
3. In Chrome, go to [chrome://extensions](chrome://extensions) → Developer mode → Load unpacked → the unzipped folder.

### Installing from source

1. Install [Deno](https://github.com/denoland/deno_install) first if you don't have it
2. `git clone https://github.com/cqvo/mparticle-developer-tools.git && cd mparticle-developer-tools`
3. Install dependencies via `deno install`
4. Build from source `deno task build`
5. In Chrome, go to [chrome://extensions](chrome://extensions) → Developer mode → Load unpacked → the `dist/` folder.

### Releasing

Bump `version` in `src/manifest.json` on a branch and merge it to `main`.

Then run the `release` workflow from the Actions tab (or `gh workflow run release.yml -f channel=beta`) and pick `beta`
or `production`. It runs the tests, builds, tags the current `main` commit, and publishes the zip. Betas are numbered
automatically; production fails if that version is already tagged.

## Using the extension

Open Chrome DevTools on any page and go to the "mParticle" tab. The dropdown in the tab bar picks which
`mParticle._instances` entry the Forwarders, Identity, and Force Batch Upload features talk to (`default_instance` by
default).

Events tab: each event in a batch is listed as its own row as requests finish (expand "raw" for the event JSON).
Identity API requests (`/identity/v1/identify`, `/identity/v1/login`, `/identity/v1/logout`) get one row each, showing
the request's `known_identities` and the response's `matched_identities` along with the resulting MPID and login state.
"Force Batch Upload" calls `mParticle.upload()` on the page to flush the queued batch. "Hide /Forwarding" on the
Settings tab (on by default) drops the kit-forwarding status posts, which carry no events. "Preserve log" keeps the list
across page navigations.

Forwarders tab: lists the kits returned by `mParticle._getActiveForwarders()` with their id and whether they have
initialized; expand "raw" for the kit settings. Refreshes on tab switch, page navigation, and the "Refresh" button.

Identity tab: MPID, device id, login state, identities, user attributes and consent state for the current user from
`mParticle.Identity.getCurrentUser()`. Refreshes like the Forwarders tab.

The URL filter on the Settings tab matches anywhere in the request URL, and `|` separates alternatives: a request is
kept if its URL contains any of the `|`-separated substrings. It defaults to `/webevents/|identity`, covering the events
API path on both the default host (`www.mparticle.com`) and custom CNAME hosts configured via
`v1/v2/v3SecureServiceUrl`, plus the identity API. Change it if you need to catch something else.

## Development

`deno task test` runs the unit tests in jsdom. `deno task e2e` builds `dist/`, launches your installed Chrome with the
extension loaded, opens DevTools on www.mparticle.com and www.google.com, and checks that the panel lists mParticle
requests on the first and nothing on the second. It opens a visible Chrome window and needs network access; CI runs it
nightly rather than on every pull request.
