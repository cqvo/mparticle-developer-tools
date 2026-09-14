# mParticle Developer Tools

Chrome DevTools extension that lists the network requests a page sends to mParticle's events API.

Load: chrome://extensions → Developer mode → Load unpacked → this folder. No build step.

Use: open Chrome DevTools on any page and go to the "mParticle" tab. Requests are listed as
they finish, with the event summaries from the POST body (expand "raw" for the full JSON).

The filter box matches anywhere in the request URL and defaults to `/webevents/`, which is the
events API path on both the default host (`www.mparticle.com`) and custom CNAME hosts configured
via `v1/v2/v3SecureServiceUrl`. Change it if you need to catch something else.

Package for the Web Store: `git archive --format=zip -o mparticle-developer-tools.zip HEAD` (manifest lands at the zip root).
