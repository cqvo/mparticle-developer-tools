# mParticle Developer Tools

[![test](https://img.shields.io/github/actions/workflow/status/cqvo/mparticle-developer-tools/test.yml?branch=main&label=test)](https://github.com/cqvo/mparticle-developer-tools/actions/workflows/test.yml)
[![e2e](https://img.shields.io/github/actions/workflow/status/cqvo/mparticle-developer-tools/e2e.yml?label=e2e)](https://github.com/cqvo/mparticle-developer-tools/actions/workflows/e2e.yml)
[![stable](https://img.shields.io/github/v/release/cqvo/mparticle-developer-tools?sort=semver&filter=!*-*&label=stable)](https://github.com/cqvo/mparticle-developer-tools/releases/latest)
[![beta](https://img.shields.io/github/v/release/cqvo/mparticle-developer-tools?include_prereleases&sort=semver&filter=*-beta.*&label=beta)](https://github.com/cqvo/mparticle-developer-tools/releases?q=beta)
[![deno](https://img.shields.io/badge/deno-2.9.6-blue?logo=deno)](https://deno.land)
[![license](https://img.shields.io/github/license/cqvo/mparticle-developer-tools)](LICENSE)

Chrome DevTools extension that adds an "mParticle" panel: it lists the events and identity requests a page sends to
mParticle and lets you inspect the page's `mParticle` SDK instance (forwarders, current user, force upload).

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

Events tab: each event in a batch is listed as its own row as requests finish, headed by its `event_type` followed by
the screen name for a `screen_view`, the event name for a `custom_event`, or the product action (`checkout`, `purchase`,
...) for a `commerce_event`. Each row then groups its details into two sections. Under "Event Data" each object-valued
field of the event gets its own expander (`custom_attributes`, `custom_flags`, and whatever else the event carries) and
the scalar fields are grouped under `event_attributes`. The expanders within a section are listed alphabetically with
the attributes one last, and `custom_attributes` starts open. "Batch Data" does the same for the batch the event arrived
in: an expander per object (`consent_state`, `user_attributes`, `user_identities`, `device_info`, ...) and the rest
under `batch_attributes`. Both sections collapse, with "Batch Data" collapsed to start. Last comes "raw", which holds
the event JSON. Identity API requests (such as `/v1/identify`, `/v1/login` and `/v1/logout` on `identity.mparticle.com`
or a CNAME host) get one row each, showing the request's `known_identities` and the response's `matched_identities`
along with the resulting MPID and login state; these are recognized by the `known_identities` in the request body rather
than by the URL, so the filter only has to let the request through. Anything else that passes the filter gets one row
per request showing its query string, or its raw body if it has one. The collapse button (chevrons icon, "Collapse All"
on hover) closes every expander in the list, and the upload button (cloud icon, "Force Batch Upload" on hover) calls
`mParticle.upload()` on the page to flush the queued batch. "Hide /Forwarding" on the Settings tab (on by default) drops
the kit-forwarding status posts, which carry no events. "Preserve log" keeps the list across page navigations.

Forwarders tab: lists the kits returned by `mParticle._getActiveForwarders()` with their id and whether they have
initialized; "settings (N)" expands into a key/value grid of the kit's settings when it reports any, and "raw" holds the
whole record. Refreshes on tab switch, page navigation, an instance change, and the refresh button.

Identity tab: MPID, device id, login state, identities, user attributes and consent state for the current user from
`mParticle.Identity.getCurrentUser()`. Refreshes like the Forwarders tab.

The panel lists only requests whose URL matches a fixed pattern covering mParticle's endpoints under `/v1/` through
`/v3/`: the identity API (`identify`, `login`, `logout`, `modify`), the remote config, `/Forwarding`, and the event
upload path (`.../v3/JS/<key>/events` on the default host `jssdks.mparticle.com`, and the same path on CNAME hosts
configured via the `v2SecureServiceUrl`/`v3SecureServiceUrl` options). The pattern is not configurable; the Settings tab
holds just the "Hide /Forwarding" toggle.

## Development

`deno task test` runs the unit tests in jsdom. `deno task e2e` builds `dist/`, launches your installed Chrome with the
extension loaded, opens DevTools on www.mparticle.com and www.google.com, and checks that the panel lists mParticle
requests on the first and nothing on the second. It opens a visible Chrome window and needs network access; CI runs it
nightly rather than on every pull request. Before pushing, run what CI runs: `deno fmt --check`, `deno lint`,
`deno task check`, `deno task test`, `deno task build`. AGENTS.md covers the architecture and the test harness.
