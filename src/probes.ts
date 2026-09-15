// Each exported function here is a probe: it is stringified with `String(fn)` and evaluated inside the
// inspected page, so its body must not reference anything outside its own parameters and body — no
// closures over module/file scope. The test harness runs probes in a bare vm context, so any free
// identifier will fail the existing tests.

export interface MpUser {
  getMPID?: () => unknown;
  isLoggedIn?: () => unknown;
  getUserIdentities?: () => { userIdentities?: unknown };
  getAllUserAttributes?: () => unknown;
  getConsentState?: () => unknown;
}

export interface MpInstance {
  _getActiveForwarders?: () => Array<{ name: string; id: number; initialized?: boolean; settings?: unknown }>;
  getDeviceId?: () => unknown;
  upload?: () => void;
  Identity?: { getCurrentUser?: () => MpUser | null | undefined };
}

export interface ForwarderInfo {
  name: string;
  id: number;
  initialized?: boolean;
  settings?: unknown;
  error?: string;
}

export interface IdentityInfo {
  mpid: unknown;
  deviceId: unknown;
  isLoggedIn: unknown;
  identities: unknown;
  attributes: unknown;
  consent: unknown;
}

export type ProbeError = { error: string };

export function probeForwarders(mp?: MpInstance): ForwarderInfo[] | ProbeError {
  if (!mp || typeof mp._getActiveForwarders !== 'function') return { error: 'instance not found on page' };
  try {
    return mp._getActiveForwarders().map(
      (f: { name: string; id: number; initialized?: boolean; settings?: unknown }) => {
        try {
          return {
            name: f.name,
            id: f.id,
            initialized: f.initialized,
            settings: JSON.parse(
              JSON.stringify(f.settings || {}, (_k: string, v: unknown) => typeof v === 'function' ? undefined : v),
            ),
          };
        } catch (e) {
          return { name: f.name, id: f.id, error: String(e) };
        }
      },
    );
  } catch (e) {
    return { error: String(e) };
  }
}

export function probeIdentity(mp?: MpInstance): IdentityInfo | ProbeError {
  if (!mp || !mp.Identity || typeof mp.Identity.getCurrentUser !== 'function') {
    return { error: 'instance not found on page' };
  }
  const u = mp.Identity.getCurrentUser();
  if (!u) return { error: 'no current user' };
  const get = (fn: () => unknown): unknown => {
    try {
      return fn();
    } catch (e) {
      return String(e);
    }
  };
  return {
    mpid: get(() => u.getMPID!()),
    deviceId: get(() => mp.getDeviceId!()),
    isLoggedIn: get(() => u.isLoggedIn!()),
    identities: get(() => u.getUserIdentities!().userIdentities),
    attributes: get(() => u.getAllUserAttributes!()),
    consent: get(() => JSON.parse(JSON.stringify(u.getConsentState!() || null))),
  };
}

export function probeUpload(mp?: MpInstance): 'ok' | ProbeError {
  if (!mp || typeof mp.upload !== 'function') return { error: 'instance not found on page' };
  mp.upload();
  return 'ok';
}
