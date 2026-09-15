# Domain terms

Instance — an entry in `window.mParticle._instances`; `default_instance` falls back to `window.mParticle` itself.

Probe — a self-contained function exported from `src/probes.ts`, stringified with `String(fn)` and evaluated inside the
inspected page against the selected Instance, returning a value or `{ error }`; it must not reference anything outside
its own body.

Forwarder — a kit returned by the Instance's `_getActiveForwarders()`.

Identity — the current user from the Instance's `Identity.getCurrentUser()`.

Batch — the `events` array in one request body to `/webevents/`; each event renders as its own row.

Identity request — a body carrying `known_identities` posted to the identity API (`/v1/identify`, `/login`, `/logout`);
renders as one row joined with its response (`matched_identities`, `mpid`, `is_logged_in`).
