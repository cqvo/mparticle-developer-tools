import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadPanel, entry, fakeMp, fakeUser } from './harness.js';

const TS = Date.UTC(2026, 0, 2, 3, 4, 5); // 03:04:05 UTC
const labels = (el) => [...el.querySelectorAll('summary')].map((s) => s.textContent);
const detail = (el, label) => [...el.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent === label);
const ev = (over = {}) => ({ event_type: 'custom_event', data: { event_name: 'Checkout', timestamp_unixtime_ms: TS, ...over } });

describe('events', () => {
  it('renders one row per event in a batch', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [ev(), ev({ event_name: 'Purchase' })] } }));

    const rows = p.$$('#list li');
    assert.equal(rows.length, 2);
    assert.equal(p.$('#count').textContent, '2');

    const li = rows[0];
    assert.equal(li.querySelector('.time').textContent, '03:04:05');
    assert.equal(li.querySelector('.method').textContent, 'POST');
    assert.equal(li.querySelector('.status').textContent, '202');
    assert.ok(li.querySelector('.status').classList.contains('ok'));
    assert.equal(li.querySelector('.url').textContent, 'jssdks.mparticle.com/v3/JS/key/webevents/events');
    assert.equal(li.querySelector('.url').title, 'https://jssdks.mparticle.com/v3/JS/key/webevents/events');
    assert.equal(li.querySelector('.type').textContent, 'custom_event');
    assert.equal(li.querySelector('.name').textContent, 'Checkout');
    assert.equal(rows[1].querySelector('.name').textContent, 'Purchase');
  });

  it('shows an attribute count only when custom_attributes is present', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [ev({ custom_attributes: { a: 1, b: 2 } }), ev()] } }));
    const [withAttrs, without] = p.$$('#list li');
    assert.equal(withAttrs.querySelector('.attrs-count').textContent, '(2 attrs)');
    assert.equal(without.querySelector('.attrs-count'), null);
  });

  it('expands custom_attributes and custom_flags as key/value pairs', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [ev({
      custom_attributes: { a: 1, nested: { x: 1 }, gone: null },
      custom_flags: { 'Google.Page': '/home' },
    })] } }));

    const li = p.$('#list li');
    assert.deepEqual(labels(li), ['custom_attributes (3)', 'custom_flags (1)', 'raw']);

    const kv = detail(li, 'custom_attributes (3)').querySelector('.kv');
    assert.deepEqual([...kv.children].map((c) => c.textContent),
      ['a', '1', 'nested', '{"x":1}', 'gone', 'null']);
    assert.deepEqual([...detail(li, 'custom_flags (1)').querySelector('.kv').children].map((c) => c.textContent),
      ['Google.Page', '/home']);
  });

  it('omits details for missing or empty objects', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [ev({ custom_flags: {} })] } }));
    assert.deepEqual(labels(p.$('#list li')), ['raw']);
  });

  it('shows the pretty-printed event as raw', () => {
    const p = loadPanel();
    const event = ev({ custom_attributes: { a: 1 } });
    p.request(entry({ body: { events: [event] } }));
    assert.equal(detail(p.$('#list li'), 'raw').querySelector('pre').textContent,
      JSON.stringify(event, null, 2));
  });

  it('falls back to the request time when the event has no timestamp', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [{ event_type: 'session_start', data: {} }] },
      startedDateTime: '2026-01-02T11:22:33.000Z' }));
    assert.equal(p.$('#list li .time').textContent, '11:22:33');
  });

  describe('filter', () => {
    it('ignores URLs that do not match', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://example.com/other' }));
      assert.equal(p.$$('#list li').length, 0);
    });

    it('matches case-insensitively', () => {
      const p = loadPanel();
      p.$('#filter').value = '/WEBEVENTS/';
      p.request(entry({ body: 'x' }));
      assert.equal(p.$$('#list li').length, 1);
    });

    it('matches everything when empty', () => {
      const p = loadPanel();
      p.$('#filter').value = '';
      p.request(entry({ url: 'https://example.com/other', body: 'x' }));
      assert.equal(p.$$('#list li').length, 1);
    });
  });

  describe('hide /Forwarding', () => {
    const forwarding = (p, url) => { p.$('#filter').value = ''; p.request(entry({ url, body: 'x' })); };

    it('drops /Forwarding and /Forwarding?x=1 while checked', () => {
      const p = loadPanel();
      forwarding(p, 'https://example.com/Forwarding');
      forwarding(p, 'https://example.com/Forwarding?x=1');
      assert.equal(p.$$('#list li').length, 0);
    });

    it('shows them when unchecked', () => {
      const p = loadPanel();
      p.$('#hide-forwarding').checked = false;
      forwarding(p, 'https://example.com/Forwarding');
      assert.equal(p.$$('#list li').length, 1);
    });

    it('never drops /ForwardingX', () => {
      const p = loadPanel();
      forwarding(p, 'https://example.com/ForwardingX');
      assert.equal(p.$$('#list li').length, 1);
    });
  });

  it('lists the query string when there is no post body', () => {
    const p = loadPanel();
    p.request(entry({ method: 'GET', queryString: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }] }));
    const li = p.$('#list li');
    assert.equal(p.$$('#list li').length, 1);
    assert.deepEqual([...li.querySelectorAll('.param')].map((e) => e.textContent), ['a=1', 'b=2']);
  });

  it('shows a non-JSON body verbatim', () => {
    const p = loadPanel();
    p.request(entry({ body: 'not json at all' }));
    assert.equal(p.$$('#list li').length, 1);
    assert.equal(p.$('#list li pre').textContent, 'not json at all');
  });

  it('shows a JSON body without an events array as pretty JSON', () => {
    const p = loadPanel();
    const body = { mpid: '123', source_request_id: 'abc' };
    p.request(entry({ body }));
    assert.equal(p.$$('#list li').length, 1);
    assert.equal(p.$('#list li pre').textContent, JSON.stringify(body, null, 2));
  });

  it('marks a failing status', () => {
    const p = loadPanel();
    p.request(entry({ status: 400, body: 'x' }));
    const status = p.$('#list li .status');
    assert.equal(status.textContent, '400');
    assert.ok(status.classList.contains('err'));
    assert.ok(!status.classList.contains('ok'));
  });

  it('keeps an unparseable URL as-is', () => {
    const p = loadPanel();
    p.$('#filter').value = '';
    p.request(entry({ url: 'not a url', body: 'x' }));
    assert.equal(p.$('#list li .url').textContent, 'not a url');
  });

  it('clears the list', () => {
    const p = loadPanel();
    p.request(entry({ body: 'x' }));
    p.click('clear');
    assert.equal(p.$$('#list li').length, 0);
    assert.equal(p.$('#count').textContent, '0');
  });

  it('clears on navigation unless the log is preserved', () => {
    const p = loadPanel();
    p.request(entry({ body: 'x' }));
    p.navigate();
    assert.equal(p.$$('#list li').length, 0);

    p.request(entry({ body: 'x' }));
    p.$('#preserve').checked = true;
    p.navigate();
    assert.equal(p.$$('#list li').length, 1);
    assert.equal(p.$('#count').textContent, '1');
  });
});

describe('instance selector', () => {
  const options = (p) => [...p.$('#instance').options].map((o) => o.value);
  const withInstances = (names) => fakeMp({ instances: Object.fromEntries(names.map((n) => [n, fakeMp()])) });

  it('lists default_instance first', () => {
    const p = loadPanel({ mParticle: withInstances(['a', 'default_instance', 'b']) });
    assert.deepEqual(options(p), ['default_instance', 'a', 'b']);
  });

  it('keeps the current selection when it still exists', () => {
    const p = loadPanel({ mParticle: withInstances(['default_instance', 'a', 'b']) });
    p.setInstance('a');
    p.page.mParticle = withInstances(['default_instance', 'a']);
    p.clickTab('forwarders');
    assert.deepEqual(options(p), ['default_instance', 'a']);
    assert.equal(p.$('#instance').value, 'a');
  });

  it('falls back to default_instance when the selection disappears', () => {
    const p = loadPanel({ mParticle: withInstances(['default_instance', 'a', 'b']) });
    p.setInstance('a');
    p.page.mParticle = withInstances(['default_instance', 'b']);
    p.clickTab('forwarders');
    assert.deepEqual(options(p), ['default_instance', 'b']);
    assert.equal(p.$('#instance').value, 'default_instance');
  });

  it('leaves the options alone when mParticle is missing', () => {
    const p = loadPanel();
    assert.deepEqual(options(p), ['default_instance']);
    p.clickTab('forwarders');
    assert.deepEqual(options(p), ['default_instance']);
  });

  it('leaves the options alone when the eval throws', () => {
    const p = loadPanel({ mParticle: withInstances(['default_instance', 'a', 'b']) });
    assert.deepEqual(options(p), ['default_instance', 'a', 'b']);
    Object.defineProperty(p.page, 'mParticle', { get() { throw new Error('x'); } });
    p.clickTab('forwarders');
    assert.deepEqual(options(p), ['default_instance', 'a', 'b']);
  });

  it('reads forwarders from the selected instance', () => {
    const p = loadPanel({ mParticle: fakeMp({
      forwarders: [{ name: 'Default kit', id: 1, initialized: true }],
      instances: {
        default_instance: fakeMp({ forwarders: [{ name: 'Default kit', id: 1, initialized: true }] }),
        a: fakeMp({ forwarders: [{ name: 'A kit', id: 2, initialized: true }] }),
      },
    }) });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-list .name').textContent, 'Default kit');
    p.setInstance('a');
    assert.equal(p.$('#fwd-list .name').textContent, 'A kit');
  });

  it('falls back to window.mParticle when _instances has no default_instance', () => {
    const p = loadPanel({ mParticle: fakeMp({
      forwarders: [{ name: 'Root kit', id: 1, initialized: true }],
      instances: { a: fakeMp({ forwarders: [] }) },
    }) });
    p.clickTab('forwarders');
    assert.equal(p.$('#instance').value, 'default_instance');
    assert.equal(p.$('#fwd-list .name').textContent, 'Root kit');
  });

  it('re-runs the visible tab loader on change', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [{ name: 'First', id: 1, initialized: true }] }) });
    p.clickTab('forwarders');
    p.page.mParticle = fakeMp({ forwarders: [{ name: 'Second', id: 2, initialized: true }] });
    p.setInstance('default_instance');
    assert.equal(p.$('#fwd-list .name').textContent, 'Second');
  });

  it('evaluates nothing on change while the events tab is visible', () => {
    const p = loadPanel({ mParticle: fakeMp() });
    const before = p.page.evals.length;
    p.setInstance('default_instance');
    assert.equal(p.page.evals.length, before);
  });
});

describe('tabs', () => {
  it('shows only the clicked tab and runs its loader', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [{ name: 'GA4', id: 160, initialized: true }] }) });
    p.clickTab('forwarders');

    assert.deepEqual(p.$$('section').filter((s) => !s.hidden).map((s) => s.id), ['forwarders']);
    assert.deepEqual(p.$$('#tabs button.active').map((b) => b.dataset.tab), ['forwarders']);
    assert.equal(p.$$('#fwd-list li').length, 1);
  });

  it('ignores clicks on the tab bar itself', () => {
    const p = loadPanel({ mParticle: fakeMp() });
    const before = p.page.evals.length;
    p.click('tabs');
    assert.deepEqual(p.$$('section').filter((s) => !s.hidden).map((s) => s.id), ['events']);
    assert.deepEqual(p.$$('#tabs button.active').map((b) => b.dataset.tab), ['events']);
    assert.equal(p.page.evals.length, before);
  });
});

describe('forwarders', () => {
  const kits = [
    { name: 'GA4', id: 160, initialized: true, settings: { apiKey: 'k' } },
    { name: 'Braze', id: 42, initialized: false, settings: {} },
  ];

  it('renders each forwarder', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: kits }) });
    p.clickTab('forwarders');

    assert.equal(p.$('#fwd-status').textContent, '2 forwarder(s)');
    const [ga, braze] = p.$$('#fwd-list li');
    assert.equal(ga.querySelector('.name').textContent, 'GA4');
    assert.deepEqual([...ga.querySelectorAll('.meta div')].map((d) => d.textContent),
      ['GA4', 'id: 160', 'initialized']);
    assert.ok(ga.querySelector('.meta div:last-child').classList.contains('ok'));
    assert.equal(ga.querySelector('pre').textContent, JSON.stringify(kits[0], null, 2));

    assert.equal(braze.querySelector('.meta div:last-child').textContent, 'not initialized');
    assert.ok(braze.querySelector('.meta div:last-child').classList.contains('err'));
  });

  it('reports an empty list', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [] }) });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status').textContent, 'No active forwarders');
    assert.equal(p.$$('#fwd-list li').length, 0);
  });

  it('reports a missing instance', () => {
    const p = loadPanel();
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status').textContent, 'instance not found on page');
  });

  it('reports a throwing _getActiveForwarders', () => {
    const mp = fakeMp();
    mp._getActiveForwarders = () => { throw new Error('boom'); };
    const p = loadPanel({ mParticle: mp });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status').textContent, 'Error: boom');
  });

  it('drops functions from the settings', () => {
    const p = loadPanel({ mParticle: fakeMp({
      forwarders: [{ name: 'GA4', id: 160, initialized: true, settings: { apiKey: 'k', onLoad() {} } }],
    }) });
    p.clickTab('forwarders');
    const raw = p.$('#fwd-list pre').textContent;
    assert.ok(raw.includes('apiKey'));
    assert.ok(!raw.includes('onLoad'));
  });

  it('still renders a forwarder whose settings are circular', () => {
    const settings = { apiKey: 'k' };
    settings.self = settings;
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [{ name: 'GA4', id: 160, initialized: true, settings }] }) });
    p.clickTab('forwarders');

    const li = p.$('#fwd-list li');
    assert.equal(li.querySelector('.name').textContent, 'GA4');
    assert.equal(li.querySelectorAll('.meta div')[1].textContent, 'id: 160');
    assert.ok(JSON.parse(li.querySelector('pre').textContent).error);
  });

  it('reports a failed eval', () => {
    const p = loadPanel({ mParticle: fakeMp() });
    Object.defineProperty(p.page, 'mParticle', { get() { throw new Error('x'); } });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status').textContent, 'eval failed: Error: x');
  });

  it('re-renders on refresh', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [{ name: 'GA4', id: 160, initialized: true }] }) });
    p.clickTab('forwarders');
    p.page.mParticle = fakeMp({ forwarders: [{ name: 'Braze', id: 42, initialized: true }] });
    p.click('refresh');
    assert.deepEqual(p.$$('#fwd-list .name').map((e) => e.textContent), ['Braze']);
  });
});

describe('identity', () => {
  it('renders the current user', () => {
    const user = fakeUser({
      identities: { email: 'a@b.c', customerid: '42' },
      attributes: { plan: 'pro' },
      consent: { gdpr: { parking: { consented: true } } },
    });
    const p = loadPanel({ mParticle: fakeMp({ user, deviceId: 'das-1' }) });
    p.clickTab('identity');

    assert.equal(p.$('#id-status').textContent, '');
    const [head, body] = p.$$('#id-list li');
    assert.deepEqual([...head.querySelectorAll('.meta div')].map((d) => d.textContent),
      ['MPID: mpid-1', 'device: das-1', 'logged in']);
    assert.ok(head.querySelector('.meta div:last-child').classList.contains('ok'));

    assert.deepEqual(labels(body), ['identities (2)', 'user attributes (1)', 'consent']);
    assert.deepEqual([...detail(body, 'identities (2)').querySelector('.kv').children].map((c) => c.textContent),
      ['email', 'a@b.c', 'customerid', '42']);
    assert.equal(detail(body, 'consent').querySelector('pre').textContent,
      JSON.stringify({ gdpr: { parking: { consented: true } } }, null, 2));
  });

  it('marks a logged out user', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: fakeUser({ loggedIn: false }) }) });
    p.clickTab('identity');
    const state = p.$('#id-list .meta div:last-child');
    assert.equal(state.textContent, 'logged out');
    assert.ok(state.classList.contains('muted'));
  });

  it('renders only the head row when there is nothing to expand', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: fakeUser() }) });
    p.clickTab('identity');
    assert.equal(p.$$('#id-list li').length, 1);
  });

  it('shows the error from a throwing getter', () => {
    const user = fakeUser();
    user.getMPID = () => { throw new Error('nope'); };
    const p = loadPanel({ mParticle: fakeMp({ user }) });
    p.clickTab('identity');
    assert.equal(p.$('#id-list .name').textContent, 'MPID: Error: nope');
  });

  it('reports no current user', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: null }) });
    p.clickTab('identity');
    assert.equal(p.$('#id-status').textContent, 'no current user');
    assert.equal(p.$$('#id-list li').length, 0);
  });

  it('reports a missing instance', () => {
    const p = loadPanel();
    p.clickTab('identity');
    assert.equal(p.$('#id-status').textContent, 'instance not found on page');
  });

  it('re-renders on refresh', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: fakeUser({ mpid: 'one' }) }) });
    p.clickTab('identity');
    p.page.mParticle = fakeMp({ user: fakeUser({ mpid: 'two' }) });
    p.click('id-refresh');
    assert.equal(p.$('#id-list .name').textContent, 'MPID: two');
  });
});

describe('upload', () => {
  it('calls upload on the instance', () => {
    const p = loadPanel({ mParticle: fakeMp() });
    p.click('upload');
    assert.equal(p.page.mParticle.uploads, 1);
    assert.deepEqual(p.page.warnings, []);
  });

  it('warns when the instance is missing', () => {
    const p = loadPanel();
    p.click('upload');
    assert.deepEqual(p.page.warnings, [['mParticle upload:', 'instance not found on page']]);
  });
});
