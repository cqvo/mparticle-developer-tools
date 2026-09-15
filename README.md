# mParticle Developer Tools

Chrome DevTools extension that lists the network requests a page sends to mParticle's events API.

Load: chrome://extensions → Developer mode → Load unpacked → this folder. No build step.

Use: open Chrome DevTools on any page and go to the "mParticle" tab. The dropdown in the tab bar picks
which `mParticle._instances` entry the Forwarders, Identity, and Upload features talk to
(`default_instance` by default).

Events tab: each event in a batch is listed as its own row as requests finish
(expand "raw" for the event JSON). "Upload" calls `mParticle.upload()` on the page to flush the
queued batch. "Hide /Forwarding" (on by default) drops the kit-forwarding status posts, which
carry no events. "Preserve log" keeps the list across page navigations.

Forwarders tab: lists the kits returned by `mParticle._getActiveForwarders()` with their id and
whether they have initialized; expand "raw" for the kit settings. Refreshes on tab switch, page
navigation, and the "Refresh" button.

Identity tab: MPID, device id, login state, identities, user attributes and consent state for the current
user from `mParticle.Identity.getCurrentUser()`. Refreshes like the Forwarders tab.

The filter box matches anywhere in the request URL and defaults to `/webevents/`, which is the
events API path on both the default host (`www.mparticle.com`) and custom CNAME hosts configured
via `v1/v2/v3SecureServiceUrl`. Change it if you need to catch something else.

Package for the Web Store: `git archive --format=zip -o mparticle-developer-tools.zip HEAD` (manifest lands at the zip root).
