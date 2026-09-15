# mParticle Developer Tools

Chrome DevTools extension that lists the network requests a page sends to mParticle's events API.

## Quickstart

### Installing from source

1. Install [Deno](https://github.com/denoland/deno_install) first if you don't have it
2. `git clone https://github.com/cqvo/mparticle-developer-tools.git && cd mparticle-developer-tools`
3. Install dependencies via `deno install`
4. Build from source `deno task build`
5. In Chrome, go to [chrome://extensions](chrome://extensions) → Developer mode → Load unpacked → the `dist/` folder.

## Using the extension

Open Chrome DevTools on any page and go to the "mParticle" tab. The dropdown in the tab bar picks which
`mParticle._instances` entry the Forwarders, Identity, and Force Batch Upload features talk to (`default_instance` by default).
Events tab: each event in a batch is listed as its own row as requests finish (expand "raw" for the event JSON).
"Force Batch Upload" calls `mParticle.upload()` on the page to flush the queued batch. "Hide /Forwarding" on the Settings tab (on by
default) drops the kit-forwarding status posts, which carry no events. "Preserve log" keeps the list across page
navigations.

Forwarders tab: lists the kits returned by `mParticle._getActiveForwarders()` with their id and whether they have
initialized; expand "raw" for the kit settings. Refreshes on tab switch, page navigation, and the "Refresh" button.

Identity tab: MPID, device id, login state, identities, user attributes and consent state for the current user from
`mParticle.Identity.getCurrentUser()`. Refreshes like the Forwarders tab.

The URL filter on the Settings tab matches anywhere in the request URL and defaults to `/webevents/`, which is the
events API path on both the default host (`www.mparticle.com`) and custom CNAME hosts configured via
`v1/v2/v3SecureServiceUrl`. Change it if you need to catch something else.
