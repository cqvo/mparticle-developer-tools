const list = document.getElementById('list');
const countEl = document.getElementById('count');
const filterInput = document.getElementById('filter');

let count = 0;

function clear() {
  list.replaceChildren();
  count = 0;
  countEl.textContent = '0';
}

document.getElementById('clear').addEventListener('click', clear);
chrome.devtools.network.onNavigated.addListener(() => {
  if (!document.getElementById('preserve').checked) clear();
});

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

function renderBody(li, entry) {
  const text = entry.request.postData && entry.request.postData.text;
  if (!text) {
    for (const p of entry.request.queryString || []) line(li, `${p.name}=${p.value}`, 'param');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const pre = document.createElement('pre');
    pre.textContent = text;
    li.appendChild(pre);
    return;
  }

  if (parsed && Array.isArray(parsed.events)) {
    for (const event of parsed.events) line(li, summarize(event), 'event');
  }

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'raw';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(parsed, null, 2);
  details.append(summary, pre);
  li.appendChild(details);
}

chrome.devtools.network.onRequestFinished.addListener((entry) => {
  const filter = filterInput.value.toLowerCase();
  if (!entry.request.url.toLowerCase().includes(filter)) return;

  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  line(meta, time(entry.startedDateTime));
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

  renderBody(li, entry);
  list.appendChild(li);
  countEl.textContent = String(++count);
});
