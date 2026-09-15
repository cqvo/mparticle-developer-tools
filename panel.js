const list = document.getElementById('list');
const countEl = document.getElementById('count');
const filterInput = document.getElementById('filter');
const instanceSelect = document.getElementById('instance');

function instanceExpr() {
  const name = instanceSelect.value || 'default_instance';
  return `((window.mParticle && window.mParticle._instances) || {})[${JSON.stringify(name)}]${name === 'default_instance' ? ' || window.mParticle' : ''}`;
}

function evalWithInstance(body, cb) {
  chrome.devtools.inspectedWindow.eval(`((mp) => {${body}})(${instanceExpr()})`, cb);
}

function loadInstances() {
  chrome.devtools.inspectedWindow.eval('Object.keys((window.mParticle && window.mParticle._instances) || {})', (names, err) => {
    if (err || !Array.isArray(names)) return;
    const wanted = ['default_instance', ...names.filter((n) => n !== 'default_instance')];
    const current = [...instanceSelect.options].map((o) => o.value);
    if (current.length === wanted.length && current.every((n, i) => n === wanted[i])) return;
    const selected = instanceSelect.value;
    instanceSelect.replaceChildren(...wanted.map((name) => new Option(name)));
    instanceSelect.value = wanted.includes(selected) ? selected : 'default_instance';
  });
}

let count = 0;

function clear() {
  list.replaceChildren();
  count = 0;
  countEl.textContent = '0';
}

document.getElementById('clear').addEventListener('click', clear);
chrome.devtools.network.onNavigated.addListener(() => {
  if (!document.getElementById('preserve').checked) clear();
  reloadVisible();
});

function reloadVisible() {
  for (const [tab, load] of Object.entries(loaders)) {
    if (!document.getElementById(tab).hidden) load();
  }
}

function line(parent, text, className) {
  const div = document.createElement('div');
  if (className) div.className = className;
  div.textContent = text;
  parent.appendChild(div);
  return div;
}

function time(startedDateTime) {
  const d = new Date(startedDateTime);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function summarize(event) {
  const parts = [event && event.event_type];
  if (event && event.data && event.data.event_name) parts.push(event.data.event_name);
  const attrs = event && event.data && event.data.custom_attributes;
  if (attrs) parts.push(`(${Object.keys(attrs).length} attrs)`);
  return parts.join(' ');
}

function expand(li, label) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  li.appendChild(details);
  return details;
}

function raw(li, value) {
  const pre = document.createElement('pre');
  pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  expand(li, 'raw').appendChild(pre);
}

function pairs(li, label, obj) {
  if (!obj || typeof obj !== 'object') return;
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const details = expand(li, `${label} (${keys.length})`);
  for (const k of keys) {
    const v = obj[k];
    line(details, `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`, 'param');
  }
}

function parseBody(entry) {
  const text = entry.request.postData && entry.request.postData.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function row(entry, when) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  line(meta, time(when));
  line(meta, entry.request.method);
  line(meta, String(entry.response.status));

  let where = entry.request.url;
  try {
    const url = new URL(entry.request.url);
    where = url.host + url.pathname;
  } catch {
    // keep the raw URL
  }
  line(meta, where, 'url');
  li.appendChild(meta);
  list.appendChild(li);
  countEl.textContent = String(++count);
  return li;
}

chrome.devtools.network.onRequestFinished.addListener((entry) => {
  const filter = filterInput.value.toLowerCase();
  if (!entry.request.url.toLowerCase().includes(filter)) return;
  if (document.getElementById('hide-forwarding').checked && /\/Forwarding(\?|$)/.test(entry.request.url)) return;

  const body = parseBody(entry);

  if (body && Array.isArray(body.events)) {
    for (const event of body.events) {
      const when = (event.data && event.data.timestamp_unixtime_ms) || entry.startedDateTime;
      const li = row(entry, when);
      line(li, summarize(event), 'event');
      pairs(li, 'custom_attributes', event.data && event.data.custom_attributes);
      pairs(li, 'custom_flags', event.data && event.data.custom_flags);
      raw(li, event);
    }
    return;
  }

  const li = row(entry, entry.startedDateTime);
  if (body === undefined) {
    for (const p of entry.request.queryString || []) line(li, `${p.name}=${p.value}`, 'param');
  } else {
    raw(li, body);
  }
});

const fwdList = document.getElementById('fwd-list');
const fwdStatus = document.getElementById('fwd-status');

const FORWARDERS_EXPR = `
  if (!mp || typeof mp._getActiveForwarders !== 'function') return { error: 'instance not found on page' };
  try {
    return mp._getActiveForwarders().map(f => {
      try {
        return {
          name: f.name, id: f.id, initialized: f.initialized,
          settings: JSON.parse(JSON.stringify(f.settings || {}, (k, v) => typeof v === 'function' ? undefined : v))
        };
      } catch (e) {
        return { name: f.name, id: f.id, error: String(e) };
      }
    });
  } catch (e) {
    return { error: String(e) };
  }
`;

function loadForwarders() {
  loadInstances();
  evalWithInstance(FORWARDERS_EXPR, (result, err) => {
    fwdList.replaceChildren();

    if (err) {
      fwdStatus.textContent = err.value ? `eval failed: ${err.value}` : 'eval failed';
      return;
    }
    if (!Array.isArray(result)) {
      fwdStatus.textContent = (result && result.error) || 'unexpected result';
      return;
    }
    fwdStatus.textContent = result.length ? `${result.length} forwarder(s)` : 'No active forwarders';

    for (const f of result) {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'meta';
      line(meta, f.name);
      line(meta, `id: ${f.id}`);
      line(meta, f.initialized ? 'initialized' : 'not initialized');
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

const idList = document.getElementById('id-list');
const idStatus = document.getElementById('id-status');

const IDENTITY_EXPR = `
  if (!mp || !mp.Identity || typeof mp.Identity.getCurrentUser !== 'function') return { error: 'instance not found on page' };
  const u = mp.Identity.getCurrentUser();
  if (!u) return { error: 'no current user' };
  const get = (fn) => { try { return fn(); } catch (e) { return String(e); } };
  return {
    mpid: get(() => u.getMPID()),
    deviceId: get(() => mp.getDeviceId()),
    isLoggedIn: get(() => u.isLoggedIn()),
    identities: get(() => u.getUserIdentities().userIdentities),
    attributes: get(() => u.getAllUserAttributes()),
    consent: get(() => JSON.parse(JSON.stringify(u.getConsentState() || null)))
  };
`;

function loadIdentity() {
  loadInstances();
  evalWithInstance(IDENTITY_EXPR, (result, err) => {
    idList.replaceChildren();

    if (err) {
      idStatus.textContent = err.value ? `eval failed: ${err.value}` : 'eval failed';
      return;
    }
    if (!result || result.error) {
      idStatus.textContent = (result && result.error) || 'unexpected result';
      return;
    }
    idStatus.textContent = '';

    const head = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    line(meta, `MPID: ${result.mpid}`);
    line(meta, `device: ${result.deviceId}`);
    line(meta, result.isLoggedIn ? 'logged in' : 'logged out');
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

const loaders = { forwarders: loadForwarders, identity: loadIdentity };

instanceSelect.addEventListener('change', reloadVisible);
document.getElementById('refresh').addEventListener('click', loadForwarders);
document.getElementById('id-refresh').addEventListener('click', loadIdentity);

document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset && e.target.dataset.tab;
  if (!tab) return;
  for (const button of document.querySelectorAll('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const s of document.querySelectorAll('section')) s.hidden = s.id !== tab;
  if (loaders[tab]) loaders[tab]();
});

document.getElementById('upload').addEventListener('click', () => {
  evalWithInstance(
    `if (!mp || typeof mp.upload !== 'function') return 'instance not found on page'; mp.upload(); return 'ok';`,
    (result, err) => {
      if (err || result !== 'ok') console.warn('mParticle upload:', err || result);
    }
  );
});

loadInstances();
