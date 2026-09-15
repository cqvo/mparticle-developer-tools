import { type MpInstance, type ProbeError, probeForwarders, probeIdentity, probeUpload } from './probes.ts';

interface MpEvent {
  event_type?: string;
  data?: {
    event_name?: string;
    timestamp_unixtime_ms?: number;
    custom_attributes?: Record<string, unknown>;
    custom_flags?: Record<string, unknown>;
  };
}

const list = document.getElementById('list') as HTMLUListElement;
const countEl = document.getElementById('count') as HTMLElement;
const filterInput = document.getElementById('filter') as HTMLInputElement;
const instanceSelect = document.getElementById('instance') as HTMLSelectElement;

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

function summaryEl(li: HTMLElement, event: MpEvent) {
  const div = document.createElement('div');
  div.className = 'event';
  span(div, (event && event.event_type) || '', 'type');
  const name = event && event.data && event.data.event_name;
  if (name) span(div, name, 'name');
  const attrs = event && event.data && event.data.custom_attributes;
  if (attrs) span(div, `(${Object.keys(attrs).length} attrs)`, 'attrs-count');
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

function raw(li: HTMLElement, value: unknown) {
  const pre = document.createElement('pre');
  pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  expand(li, 'raw').appendChild(pre);
}

function pairs(li: HTMLElement, label: string, obj: unknown) {
  if (!obj || typeof obj !== 'object') return;
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length) return;
  const details = expand(li, `${label} (${keys.length})`);
  const kv = document.createElement('div');
  kv.className = 'kv';
  for (const k of keys) {
    const v = record[k];
    span(kv, k, 'k');
    span(kv, v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v), 'v');
  }
  details.appendChild(kv);
}

function parseBody(entry: chrome.devtools.network.Request): unknown {
  const text = entry.request.postData && entry.request.postData.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
  const filter = filterInput.value.toLowerCase();
  if (!entry.request.url.toLowerCase().includes(filter)) return;
  if (
    (document.getElementById('hide-forwarding') as HTMLInputElement).checked &&
    /\/Forwarding(\?|$)/.test(entry.request.url)
  ) return;

  const body = parseBody(entry);

  if (typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events)) {
    for (const event of (body as { events: MpEvent[] }).events) {
      const when = (event.data && event.data.timestamp_unixtime_ms) || entry.startedDateTime;
      const { li, meta } = row(entry, when, true);
      summaryEl(meta, event);
      pairs(li, 'custom_attributes', event.data && event.data.custom_attributes);
      pairs(li, 'custom_flags', event.data && event.data.custom_flags);
      raw(li, event);
    }
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
      li.appendChild(meta);

      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'raw';
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(f, null, 2);
      details.append(summary, pre);
      li.appendChild(details);

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
