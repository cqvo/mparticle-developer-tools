// deno-lint-ignore-file no-explicit-any -- the fake page and chrome APIs are deliberately untyped
process.env.TZ = 'UTC'; // time() formats in local time; make expectations exact
// @ts-types="npm:@types/jsdom"
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transpile } from '@deno/emit';

const ROOT = new URL('../', import.meta.url);
const PANEL = new URL('../src/panel.ts', import.meta.url);
const html = readFileSync(new URL('panel.html', ROOT), 'utf8');
const js = (await transpile(PANEL)).get(PANEL.href)!;

export function loadPanel({ mParticle }: { mParticle?: any } = {}) {
  const page = { mParticle, evals: [] as string[], warnings: [] as unknown[][] }; // the fake inspected page
  const listeners = { request: [] as any[], navigated: [] as any[] };
  const chrome = {
    devtools: {
      inspectedWindow: {
        eval(expr: string, cb: (result: any, err: any) => void) {
          page.evals.push(expr);
          let result: any, err: any;
          try {
            // `window.mParticle` is a getter so a test can make it throw to simulate an eval exception
            result = vm.runInNewContext(expr, {
              window: {
                get mParticle() {
                  return page.mParticle;
                },
              },
            });
            if (result !== undefined) result = JSON.parse(JSON.stringify(result)); // Chrome serializes results
          } catch (e) {
            err = { isException: true, value: String(e) };
          }
          cb(result, err);
        },
      },
      network: {
        onRequestFinished: { addListener: (fn: any) => listeners.request.push(fn) },
        onNavigated: { addListener: (fn: any) => listeners.navigated.push(fn) },
      },
    },
  };
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.chrome = chrome as any;
  dom.window.console.warn = (...a: unknown[]) => page.warnings.push(a);
  dom.window.eval(js);
  const doc = dom.window.document;
  return {
    doc,
    page,
    $: <E extends Element = HTMLElement>(s: string) => doc.querySelector<E>(s),
    $$: <E extends Element = HTMLElement>(s: string) => [...doc.querySelectorAll<E>(s)],
    request: (entry: any) => listeners.request.forEach((fn) => fn(entry)),
    navigate: () => listeners.navigated.forEach((fn) => fn()),
    click: (id: string) => doc.getElementById(id)!.click(),
    clickTab: (name: string) => doc.querySelector<HTMLElement>(`#tabs [data-tab="${name}"]`)!.click(),
    setInstance: (name: string) => {
      const s = doc.getElementById('instance') as HTMLSelectElement;
      s.value = name;
      s.dispatchEvent(new dom.window.Event('change'));
    },
  };
}

// HAR-ish entry as chrome.devtools.network.onRequestFinished delivers it
export function entry({
  url = 'https://jssdks.mparticle.com/v3/JS/key/webevents/events',
  method = 'POST',
  status = 202,
  body,
  queryString = [],
  startedDateTime = '2026-01-02T03:04:05.000Z',
}: {
  url?: string;
  method?: string;
  status?: number;
  body?: unknown;
  queryString?: { name: string; value: string }[];
  startedDateTime?: string;
} = {}) {
  return {
    startedDateTime,
    request: {
      url,
      method,
      queryString,
      postData: body === undefined ? undefined : { text: typeof body === 'string' ? body : JSON.stringify(body) },
    },
    response: { status },
  };
}

export function fakeMp(
  { forwarders = [], user, deviceId = 'dev-1', instances }: {
    forwarders?: unknown[];
    user?: any;
    deviceId?: string;
    instances?: Record<string, any>;
  } = {},
) {
  const mp = {
    _getActiveForwarders: () => forwarders,
    getDeviceId: () => deviceId,
    Identity: { getCurrentUser: () => user },
    uploads: 0,
    upload() {
      this.uploads++;
    },
  } as any;
  if (instances) mp._instances = instances;
  return mp;
}

export function fakeUser(
  { mpid = 'mpid-1', loggedIn = true, identities = {}, attributes = {}, consent = null }: {
    mpid?: string;
    loggedIn?: boolean;
    identities?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    consent?: unknown;
  } = {},
) {
  return {
    getMPID: () => mpid,
    isLoggedIn: () => loggedIn,
    getUserIdentities: () => ({ userIdentities: identities }),
    getAllUserAttributes: () => attributes,
    getConsentState: () => consent,
  };
}
