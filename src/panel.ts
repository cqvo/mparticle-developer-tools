import { type MpInstance, type ProbeError, probeForwarders, probeIdentity, probeUpload } from './probes.ts';

interface MpEvent {
  event_type?: string;
  data?: {
    event_name?: string;
    screen_name?: string;
    product_action?: { action?: string } | null;
    timestamp_unixtime_ms?: number;
    custom_attributes?: Record<string, unknown>;
    custom_flags?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

interface IdentityRequest {
  request_timestamp_ms?: number;
  known_identities?: Record<string, unknown>;
}

interface IdentityResponse {
  mpid?: string;
  is_logged_in?: boolean;
  matched_identities?: Record<string, unknown>;
}

const list = document.getElementById('list') as HTMLUListElement;
const countEl = document.getElementById('count') as HTMLElement;
const instanceSelect = document.getElementById('instance') as HTMLSelectElement;
const URL_FILTER = /\/v[1-3]\/(identify|login|logout|.+\/modify|.+\/config|.+\/Forwarding|JS\/[^/]+\/events)/i;

function instanceExpr() {
  const name = instanceSelect.value || 'default_instance';
  return `((window.mParticle && window.mParticle._instances) || {})[${JSON.stringify(name)}]${
    name === 'default_instance' ? ' || window.mParticle' : ''
  }`;
}

function probe<T>(fn: (mp?: MpInstance) => T | ProbeError, cb: (result: T | ProbeError) => void) {
  chrome.devtools.inspectedWindow.eval<T | ProbeError>(`(${String(fn)})(${instanceExpr()})`, (result, err) => {
    if (err) return cb({ error: err.value ? `eval failed: ${err.value}` : 'eval failed' });
    cb(result);
  });
}

function loadInstances() {
  chrome.devtools.inspectedWindow.eval<string[]>(
    'Object.keys((window.mParticle && window.mParticle._instances) || {})',
    (names, err) => {
      if (err || !Array.isArray(names)) return;
      const wanted = ['default_instance', ...names.filter((n) => n !== 'default_instance')];
      const current = [...instanceSelect.options].map((o) => o.value);
      if (current.length === wanted.length && current.every((n, i) => n === wanted[i])) return;
      const selected = instanceSelect.value;
      instanceSelect.replaceChildren(...wanted.map((name) => new Option(name)));
      instanceSelect.value = wanted.includes(selected) ? selected : 'default_instance';
    },
  );
}

let count = 0;

function clear() {
  list.replaceChildren();
  count = 0;
  countEl.textContent = '0';
}

document.getElementById('clear')!.addEventListener('click', clear);
document.getElementById('collapse')!.addEventListener('click', () => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('#list details')) d.open = false;
});
chrome.devtools.network.onNavigated.addListener(() => {
  if (!(document.getElementById('preserve') as HTMLInputElement).checked) clear();
  reloadVisible();
});

function reloadVisible() {
  for (const [tab, load] of Object.entries(loaders)) {
    if (!document.getElementById(tab)!.hidden) load();
  }
}

function line(parent: HTMLElement, text: string, className?: string) {
  const div = document.createElement('div');
  if (className) div.className = className;
  div.textContent = text;
  parent.appendChild(div);
  return div;
}

function span(parent: HTMLElement, text: string, className?: string) {
  const el = document.createElement('span');
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function time(startedDateTime: string | number) {
  const d = new Date(startedDateTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// How to pull the name an event shows in its header, per event type.
// 'identity' is not an SDK event type - it is the synthetic row built for identity API requests.
const NAME_OF: Record<string, (d: NonNullable<MpEvent['data']>) => unknown> = {
  screen_view: (d) => d.screen_name,
  custom_event: (d) => d.event_name,
  identity: (d) => d.event_name,
  commerce_event: (d) => d.product_action?.action,
};

function summaryEl(li: HTMLElement, event: MpEvent) {
  const div = document.createElement('div');
  div.className = 'event';
  const type = (event && event.event_type) || '';
  span(div, type, 'type');
  const name = event.data && NAME_OF[type]?.(event.data);
  if (name) span(div, String(name), 'name');
  li.appendChild(div);
  return div;
}

function expand(li: HTMLElement, label: string) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  li.appendChild(details);
  return details;
}

function raw(li: HTMLElement, value: unknown, label = 'raw') {
  const pre = document.createElement('pre');
  pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  expand(li, label).appendChild(pre);
}

function kvGrid(record: Record<string, unknown>) {
  const kv = document.createElement('div');
  kv.className = 'kv';
  for (const [k, v] of Object.entries(record)) {
    span(kv, k, 'k');
    span(kv, v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v), 'v');
  }
  return kv;
}

function pairs(li: HTMLElement, label: string, obj: unknown, open = false) {
  if (!obj || typeof obj !== 'object') return;
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length) return;
  const details = expand(li, `${label} (${keys.length})`);
  details.open = open;
  details.appendChild(kvGrid(record));
}

// Every object-valued key gets its own expand, listed alphabetically; the scalars are collected into one `restLabel`
// expand that stays last. The scalars keep their payload order.
function section(li: HTMLElement, title: string, record: Record<string, unknown>, restLabel: string, open: boolean) {
  const entries = Object.entries(record);
  if (!entries.length) return;
  const details = expand(li, title);
  details.className = 'section';
  details.open = open;
  const objects: [string, unknown][] = [];
  const rest: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (v !== null && typeof v === 'object') objects.push([k, v]);
    else rest[k] = v;
  }
  for (const [k, v] of objects.sort(([a], [b]) => a.localeCompare(b))) {
    pairs(details, k, v, k === 'custom_attributes');
  }
  pairs(details, restLabel, rest);
}

function eventDetails(li: HTMLElement, event: MpEvent, batch: Record<string, unknown>) {
  section(li, 'Event Data', (event.data || {}) as Record<string, unknown>, 'event_attributes', true);
  section(li, 'Batch Data', batch, 'batch_attributes', false);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseBody(entry: chrome.devtools.network.Request): unknown {
  const text = entry.request.postData && entry.request.postData.text;
  if (!text) return undefined;
  return parseJson(text);
}

function row(entry: chrome.devtools.network.Request, when: string | number, bare = false) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  line(meta, time(when), 'time');
  if (!bare) {
    line(meta, entry.request.method, 'method');
    const status = entry.response.status;
    const statusEl = line(meta, String(status), 'status');
    statusEl.classList.add(status < 400 ? 'ok' : 'err');

    let where = entry.request.url;
    try {
      const url = new URL(entry.request.url);
      where = url.host + url.pathname;
    } catch {
      // keep the raw URL
    }
    const urlEl = line(meta, where, 'url');
    urlEl.title = entry.request.url;
  }
  li.appendChild(meta);
  list.appendChild(li);
  countEl.textContent = String(++count);
  return { li, meta };
}

chrome.devtools.network.onRequestFinished.addListener((entry: chrome.devtools.network.Request) => {
  if (!URL_FILTER.test(entry.request.url)) return;
  if (
    (document.getElementById('hide-forwarding') as HTMLInputElement).checked &&
    /\/Forwarding(\?|$)/.test(entry.request.url)
  ) return;

  const body = parseBody(entry);

  if (typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events)) {
    const { events, ...batch } = body as { events: MpEvent[] } & Record<string, unknown>;
    for (const event of events) {
      const when = (event.data && event.data.timestamp_unixtime_ms) || entry.startedDateTime;
      const { li, meta } = row(entry, when, true);
      summaryEl(meta, event);
      eventDetails(li, event, batch);
      raw(li, event);
    }
    return;
  }

  if (typeof body === 'object' && body !== null && 'known_identities' in body) {
    const req = body as IdentityRequest;
    const { li, meta } = row(entry, req.request_timestamp_ms || entry.startedDateTime);
    const op = entry.request.url.split('?')[0].split('/').pop();
    const div = summaryEl(meta, { event_type: 'identity', data: { event_name: op } });
    meta.insertBefore(div, meta.querySelector('.url'));
    pairs(li, 'known_identities', req.known_identities);
    raw(li, body);

    entry.getContent((text) => {
      const parsed = parseJson(text);
      if (typeof parsed === 'object' && parsed !== null) {
        const res = parsed as IdentityResponse;
        if (res.mpid) span(div, `→ ${res.mpid}`, 'attrs-count');
        if (typeof res.is_logged_in === 'boolean') {
          span(div, res.is_logged_in ? 'logged in' : 'logged out', res.is_logged_in ? 'ok' : 'muted');
        }
        pairs(li, 'matched_identities', res.matched_identities);
      }
      raw(li, parsed, 'response');
    });
    return;
  }

  const { li } = row(entry, entry.startedDateTime);
  if (body === undefined) {
    for (const p of entry.request.queryString || []) line(li, `${p.name}=${p.value}`, 'param');
  } else {
    raw(li, body);
  }
});

const fwdList = document.getElementById('fwd-list') as HTMLUListElement;
const fwdStatus = document.getElementById('fwd-status') as HTMLElement;

function loadForwarders() {
  loadInstances();
  probe(probeForwarders, (result) => {
    fwdList.replaceChildren();

    if (!Array.isArray(result)) {
      fwdStatus.textContent = (result && (result as ProbeError).error) || 'unexpected result';
      return;
    }
    fwdStatus.textContent = result.length ? `${result.length} forwarder(s)` : 'No active forwarders';

    for (const f of result) {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'meta';
      line(meta, f.name, 'name');
      line(meta, `id: ${f.id}`);
      line(meta, f.initialized ? 'initialized' : 'not initialized', f.initialized ? 'ok' : 'err');
      if (f.error) line(meta, f.error, 'err');
      li.appendChild(meta);
      pairs(li, 'settings', f.settings);
      raw(li, f);
      fwdList.appendChild(li);
    }
  });
}

const idList = document.getElementById('id-list') as HTMLUListElement;
const idStatus = document.getElementById('id-status') as HTMLElement;

function loadIdentity() {
  loadInstances();
  probe(probeIdentity, (result) => {
    idList.replaceChildren();

    if (!result || 'error' in result) {
      idStatus.textContent = (result && (result as ProbeError).error) || 'unexpected result';
      return;
    }
    idStatus.textContent = '';

    const head = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    line(meta, `MPID: ${result.mpid}`, 'name');
    line(meta, `device: ${result.deviceId}`);
    line(meta, result.isLoggedIn ? 'logged in' : 'logged out', result.isLoggedIn ? 'ok' : 'muted');
    head.appendChild(meta);
    idList.appendChild(head);

    const li = document.createElement('li');
    pairs(li, 'identities', result.identities);
    pairs(li, 'user attributes', result.attributes);
    if (result.consent) {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(result.consent, null, 2);
      expand(li, 'consent').appendChild(pre);
    }
    if (li.children.length) idList.appendChild(li);
  });
}

const loaders: Record<string, () => void> = { forwarders: loadForwarders, identity: loadIdentity };

instanceSelect.addEventListener('change', reloadVisible);
document.getElementById('refresh')!.addEventListener('click', loadForwarders);
document.getElementById('id-refresh')!.addEventListener('click', loadIdentity);

document.getElementById('tabs')!.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).dataset?.tab;
  if (!tab) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const s of document.querySelectorAll('section')) s.hidden = s.id !== tab;
  if (loaders[tab]) loaders[tab]();
});

document.getElementById('upload')!.addEventListener('click', () => {
  probe(probeUpload, (result) => {
    if (result !== 'ok') console.warn('mParticle upload:', typeof result === 'string' ? result : result.error);
  });
});

loadInstances();
