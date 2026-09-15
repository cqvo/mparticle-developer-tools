process.env.TZ = 'UTC'; // time() formats in local time; make expectations exact
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const html = readFileSync(new URL('panel.html', ROOT), 'utf8');
const js = readFileSync(new URL('panel.js', ROOT), 'utf8');

export function loadPanel({ mParticle } = {}) {
  const page = { mParticle, evals: [], warnings: [] }; // the fake inspected page
  const listeners = { request: [], navigated: [] };
  const chrome = { devtools: {
    inspectedWindow: { eval(expr, cb) {
      page.evals.push(expr);
      let result, err;
      try {
        // `window.mParticle` is a getter so a test can make it throw to simulate an eval exception
        result = vm.runInNewContext(expr, { window: { get mParticle() { return page.mParticle; } } });
        if (result !== undefined) result = JSON.parse(JSON.stringify(result)); // Chrome serializes results
      } catch (e) { err = { isException: true, value: String(e) }; }
      cb(result, err);
    } },
    network: {
      onRequestFinished: { addListener: (fn) => listeners.request.push(fn) },
      onNavigated: { addListener: (fn) => listeners.navigated.push(fn) },
    },
  } };
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.chrome = chrome;
  dom.window.console.warn = (...a) => page.warnings.push(a);
  dom.window.eval(js);
  const doc = dom.window.document;
  return {
    doc, page,
    $: (s) => doc.querySelector(s),
    $$: (s) => [...doc.querySelectorAll(s)],
    request: (entry) => listeners.request.forEach((fn) => fn(entry)),
    navigate: () => listeners.navigated.forEach((fn) => fn()),
    click: (id) => doc.getElementById(id).click(),
    clickTab: (name) => doc.querySelector(`#tabs [data-tab="${name}"]`).click(),
    setInstance: (name) => { const s = doc.getElementById('instance'); s.value = name; s.dispatchEvent(new dom.window.Event('change')); },
  };
}

// HAR-ish entry as chrome.devtools.network.onRequestFinished delivers it
export function entry({ url = 'https://jssdks.mparticle.com/v3/JS/key/webevents/events', method = 'POST',
  status = 202, body, queryString = [], startedDateTime = '2026-01-02T03:04:05.000Z' } = {}) {
  return { startedDateTime,
    request: { url, method, queryString,
      postData: body === undefined ? undefined : { text: typeof body === 'string' ? body : JSON.stringify(body) } },
    response: { status } };
}

export function fakeMp({ forwarders = [], user, deviceId = 'dev-1', instances } = {}) {
  const mp = { _getActiveForwarders: () => forwarders, getDeviceId: () => deviceId,
    Identity: { getCurrentUser: () => user }, uploads: 0, upload() { this.uploads++; } };
  if (instances) mp._instances = instances;
  return mp;
}

export function fakeUser({ mpid = 'mpid-1', loggedIn = true, identities = {}, attributes = {}, consent = null } = {}) {
  return { getMPID: () => mpid, isLoggedIn: () => loggedIn,
    getUserIdentities: () => ({ userIdentities: identities }),
    getAllUserAttributes: () => attributes, getConsentState: () => consent };
}
