import { describe, it } from '@std/testing/bdd';
import assert from 'node:assert/strict';
import { entry, fakeMp, fakeUser, loadPanel } from './harness.ts';

type Panel = ReturnType<typeof loadPanel>;

const TS = Date.UTC(2026, 0, 2, 3, 4, 5); // 03:04:05 UTC
const labels = (el: Element) => [...el.querySelectorAll('details:not(.section) > summary')].map((s) => s.textContent);
const sections = (el: Element) => [...el.querySelectorAll('details.section > summary')].map((s) => s.textContent);
const opened = (el: Element) =>
  [...el.querySelectorAll<HTMLDetailsElement>('details:not(.section)')].filter((d) => d.open).map((d) =>
    d.querySelector('summary')!.textContent
  );
const detail = (el: Element, label: string) =>
  [...el.querySelectorAll('details')].find((d) => d.querySelector('summary')!.textContent === label)!;
const ev = (over: Record<string, unknown> = {}) => ({
  event_type: 'custom_event',
  data: { event_name: 'Checkout', timestamp_unixtime_ms: TS, ...over },
});

describe('events', () => {
  it('renders one row per event in a batch', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [ev(), ev({ event_name: 'Purchase' })] } }));

    const rows = p.$$('#list li');
    assert.equal(rows.length, 2);
    assert.equal(p.$('#count')!.textContent, '2');

    const li = rows[0];
    assert.equal(li.querySelector('.time')!.textContent, '03:04:05');
    assert.equal(li.querySelector('.method'), null);
    assert.equal(li.querySelector('.status'), null);
    assert.equal(li.querySelector('.url'), null);
    assert.ok(li.querySelector('.meta .event'));
    assert.equal(li.querySelector('.type')!.textContent, 'custom_event');
    assert.equal(li.querySelector('.name')!.textContent, 'Checkout');
    assert.equal(rows[1].querySelector('.name')!.textContent, 'Purchase');
    assert.deepEqual(labels(li), ['event_attributes (2)', 'raw']);
    assert.deepEqual(sections(li), ['Event Data']);
  });

  it('shows screen_name for screen_view and event_name for custom_event, nothing for others', () => {
    const p = loadPanel();
    p.request(entry({
      body: {
        events: [
          ev(),
          { event_type: 'screen_view', data: { screen_name: 'Home', timestamp_unixtime_ms: TS } },
          { event_type: 'session_start', data: { timestamp_unixtime_ms: TS } },
        ],
      },
    }));

    const [custom, screen, session] = p.$$('#list li');
    assert.equal(custom.querySelector('.name')!.textContent, 'Checkout');
    assert.equal(screen.querySelector('.name')!.textContent, 'Home');
    assert.equal(session.querySelector('.name'), null);
  });

  it('expands custom_attributes and custom_flags as key/value pairs', () => {
    const p = loadPanel();
    p.request(entry({
      body: {
        events: [ev({
          custom_attributes: { a: 1, nested: { x: 1 }, gone: null },
          custom_flags: { 'Google.Page': '/home' },
        })],
      },
    }));

    const li = p.$('#list li')!;
    assert.deepEqual(labels(li), ['custom_attributes (3)', 'custom_flags (1)', 'event_attributes (2)', 'raw']);
    assert.deepEqual(sections(li), ['Event Data']);

    const kv = detail(li, 'custom_attributes (3)').querySelector('.kv')!;
    assert.deepEqual(
      [...kv.children].map((c) => c.textContent),
      ['a', '1', 'nested', '{"x":1}', 'gone', 'null'],
    );
    assert.deepEqual(
      [...detail(li, 'custom_flags (1)').querySelector('.kv')!.children].map((c) => c.textContent),
      ['Google.Page', '/home'],
    );
  });

  it('omits details for missing or empty objects', () => {
    const p = loadPanel();
    p.request(entry({ body: { events: [ev({ custom_flags: {} })] } }));
    const li = p.$('#list li')!;
    assert.deepEqual(labels(li), ['event_attributes (2)', 'raw']);
    assert.deepEqual(sections(li), ['Event Data']);
  });

  it('shows the pretty-printed event as raw', () => {
    const p = loadPanel();
    const event = ev({ custom_attributes: { a: 1 } });
    p.request(entry({ body: { events: [event] } }));
    assert.equal(
      detail(p.$('#list li')!, 'raw').querySelector('pre')!.textContent,
      JSON.stringify(event, null, 2),
    );
  });

  it('splits event and batch data into object expands and an attributes expand', () => {
    const p = loadPanel();
    const batch = {
      mpid: '1',
      environment: 'production',
      device_info: { os: 'mac' },
      user_attributes: { plan: 'pro' },
      consent_state: { gdpr: { parking: { consented: true } } },
    };
    p.request(entry({
      body: {
        events: [
          ev({
            custom_flags: { 'Google.Page': '/home' },
            custom_attributes: { a: 1 },
            source_message_id: 'm1',
            location: null,
          }),
          { event_type: 'application_state_transition', data: { timestamp_unixtime_ms: TS } },
        ],
        ...batch,
      },
    }));

    const batchLabels = ['consent_state (1)', 'device_info (1)', 'user_attributes (1)', 'batch_attributes (2)'];
    const [custom, ast] = p.$$('#list li');

    assert.deepEqual(sections(custom), ['Event Data', 'Batch Data']);
    assert.deepEqual(labels(custom), [
      'custom_attributes (1)',
      'custom_flags (1)',
      'event_attributes (4)',
      ...batchLabels,
      'raw',
    ]);
    assert.deepEqual(
      [...detail(custom, 'event_attributes (4)').querySelectorAll('.kv span')].map((e) => e.textContent),
      ['event_name', 'Checkout', 'timestamp_unixtime_ms', String(TS), 'source_message_id', 'm1', 'location', 'null'],
    );
    assert.deepEqual(
      [...detail(custom, 'batch_attributes (2)').querySelectorAll('.kv .k')].map((k) => k.textContent),
      ['mpid', 'environment'],
    );

    assert.deepEqual(sections(ast), ['Event Data', 'Batch Data']);
    assert.deepEqual(labels(ast), ['event_attributes (1)', ...batchLabels, 'raw']);

    for (const row of [custom, ast]) {
      assert.equal(detail(row, 'Event Data').open, true);
      assert.equal(detail(row, 'Batch Data').open, false);
    }
    assert.equal(detail(custom, 'custom_attributes (1)').open, true);
    assert.deepEqual(opened(custom), ['custom_attributes (1)']);
    assert.deepEqual(opened(ast), []);
  });

  it('falls back to the request time when the event has no timestamp', () => {
    const p = loadPanel();
    p.request(entry({
      body: { events: [{ event_type: 'session_start', data: {} }] },
      startedDateTime: '2026-01-02T11:22:33.000Z',
    }));
    assert.equal(p.$('#list li .time')!.textContent, '11:22:33');
    assert.deepEqual(sections(p.$('#list li')!), []);
  });

  describe('filter', () => {
    it('ignores URLs that do not match', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://example.com/other' }));
      assert.equal(p.$$('#list li').length, 0);
    });

    it('matches case-insensitively', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://x.test/V2/JS/key/Events', body: 'x' }));
      assert.equal(p.$$('#list li').length, 1);
    });

    it('matches the default v3 upload URL', () => {
      const p = loadPanel();
      p.request(entry({
        url: 'https://jssdks.mparticle.com/v3/JS/us2-cbf324c983a1464a8cef51328faad173/events',
        body: { events: [ev()] },
      }));
      assert.equal(p.$$('#list li').length, 1);
    });

    it('matches the identity endpoints', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://identity.mparticle.com/v1/identify', body: 'x' }));
      p.request(entry({ url: 'https://identity.mparticle.com/v1/login', body: 'x' }));
      p.request(entry({ url: 'https://identity.mparticle.com/v1/1234/modify', body: 'x' }));
      assert.equal(p.$$('#list li').length, 3);
    });

    it('matches the config endpoint', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://jssdkcdns.mparticle.com/JS/v2/key/config', body: 'x' }));
      assert.equal(p.$$('#list li').length, 1);
    });

    it('ignores a path with no version segment', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://example.com/events', body: 'x' }));
      assert.equal(p.$$('#list li').length, 0);
    });

    it('ignores an events path without a JS key segment', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://example.com/v2/other/events', body: 'x' }));
      assert.equal(p.$$('#list li').length, 0);
    });
  });

  describe('identity requests', () => {
    const ID_TS = 1789440092105;
    const idTime = new Date(ID_TS).toISOString().slice(11, 19);
    const identities = {
      customerid: '408578069',
      email: 'cvo@gofundme.com',
      other2: '5612f6c2-7860-4948-9cdf-f638a47fe01e',
      device_application_stamp: '5612f6c2-7860-4948-9cdf-f638a47fe01e',
    };
    const req = (over: Record<string, unknown> = {}) => ({
      client_sdk: { platform: 'web', sdk_vendor: 'mparticle', sdk_version: '2.26.4' },
      context: null,
      environment: 'production',
      request_id: '515067c2-a5a6-41d9-e2f5-d57b66831da3',
      request_timestamp_ms: ID_TS,
      previous_mpid: '2627520916699031218',
      known_identities: identities,
      ...over,
    });

    it('renders a login request with its response', () => {
      const p = loadPanel();
      p.request(entry({
        url: 'https://mp-data.gofundme.com/identity/v1/login',
        body: req(),
        responseBody: {
          context: null,
          matched_identities: identities,
          is_ephemeral: false,
          mpid: '1198623402380994759',
          is_logged_in: true,
        },
      }));

      const rows = p.$$('#list li');
      assert.equal(rows.length, 1);
      const li = rows[0];
      assert.equal(li.querySelector('.time')!.textContent, idTime);
      assert.equal(li.querySelector('.method')!.textContent, 'POST');
      assert.equal(li.querySelector('.status')!.textContent, '202');
      assert.equal(li.querySelector('.url')!.textContent, 'mp-data.gofundme.com/identity/v1/login');
      assert.equal(li.querySelector('.type')!.textContent, 'identity');
      assert.equal(li.querySelector('.name')!.textContent, 'login');
      assert.equal(li.querySelector('.event .attrs-count')!.textContent, '→ 1198623402380994759');
      assert.equal(li.querySelector('.event .ok')!.textContent, 'logged in');
      assert.deepEqual(
        [...li.querySelectorAll('.meta div')].map((d) => d.className),
        ['time', 'method', 'status ok', 'event', 'url'],
      );

      assert.deepEqual(labels(li), ['known_identities (4)', 'raw', 'matched_identities (4)', 'response']);
      assert.deepEqual(
        [...detail(li, 'known_identities (4)').querySelector('.kv')!.children].map((c) => c.textContent),
        Object.entries(identities).flat(),
      );
    });

    it('marks a logged out identify response', () => {
      const p = loadPanel();
      const known = { other2: identities.other2, device_application_stamp: identities.device_application_stamp };
      p.request(entry({
        url: 'https://mp-data.gofundme.com/identity/v1/identify',
        body: req({ known_identities: known }),
        responseBody: {
          context: null,
          matched_identities: known,
          is_ephemeral: true,
          mpid: '2627520916699031218',
          is_logged_in: false,
        },
      }));

      const li = p.$('#list li')!;
      assert.equal(li.querySelector('.name')!.textContent, 'identify');
      assert.equal(li.querySelector('.event .muted')!.textContent, 'logged out');
      assert.deepEqual(labels(li), ['known_identities (2)', 'raw', 'matched_identities (2)', 'response']);
    });

    it('matches the URL filter', () => {
      const p = loadPanel();
      p.request(entry({ url: 'https://identity.mparticle.com/v1/identify', body: req() }));
      assert.equal(p.$$('#list li').length, 1);
    });

    it('shows a non-JSON response verbatim', () => {
      const p = loadPanel();
      p.request(entry({
        url: 'https://mp-data.gofundme.com/identity/v1/login',
        body: req(),
        responseBody: 'gateway timeout',
      }));

      const li = p.$('#list li')!;
      assert.deepEqual(labels(li), ['known_identities (4)', 'raw', 'response']);
      assert.equal(detail(li, 'response').querySelector('pre')!.textContent, 'gateway timeout');
    });
  });

  describe('hide /Forwarding', () => {
    const forwarding = (p: Panel, url: string) => {
      p.request(entry({ url, body: 'x' }));
    };

    it('drops /Forwarding and /Forwarding?x=1 while checked', () => {
      const p = loadPanel();
      forwarding(p, 'https://example.com/v2/JS/key/Forwarding');
      forwarding(p, 'https://example.com/v2/JS/key/Forwarding?x=1');
      assert.equal(p.$$('#list li').length, 0);
    });

    it('shows them when unchecked', () => {
      const p = loadPanel();
      p.$<HTMLInputElement>('#hide-forwarding')!.checked = false;
      forwarding(p, 'https://example.com/v2/JS/key/Forwarding');
      assert.equal(p.$$('#list li').length, 1);
    });

    it('never drops /ForwardingX', () => {
      const p = loadPanel();
      forwarding(p, 'https://example.com/v2/JS/key/ForwardingX');
      assert.equal(p.$$('#list li').length, 1);
    });
  });

  it('lists the query string when there is no post body', () => {
    const p = loadPanel();
    p.request(entry({ method: 'GET', queryString: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }] }));
    const li = p.$('#list li')!;
    assert.equal(p.$$('#list li').length, 1);
    assert.deepEqual([...li.querySelectorAll('.param')].map((e) => e.textContent), ['a=1', 'b=2']);
  });

  it('shows a non-JSON body verbatim', () => {
    const p = loadPanel();
    p.request(entry({ body: 'not json at all' }));
    assert.equal(p.$$('#list li').length, 1);
    assert.equal(p.$('#list li pre')!.textContent, 'not json at all');
  });

  it('shows a JSON body without an events array as pretty JSON', () => {
    const p = loadPanel();
    const body = { mpid: '123', source_request_id: 'abc' };
    p.request(entry({ body }));
    assert.equal(p.$$('#list li').length, 1);
    assert.equal(p.$('#list li pre')!.textContent, JSON.stringify(body, null, 2));
  });

  it('marks a failing status', () => {
    const p = loadPanel();
    p.request(entry({ status: 400, body: 'x' }));
    const status = p.$('#list li .status')!;
    assert.equal(status.textContent, '400');
    assert.ok(status.classList.contains('err'));
    assert.ok(!status.classList.contains('ok'));
  });

  it('keeps an unparseable URL as-is', () => {
    const p = loadPanel();
    p.request(entry({ url: 'not a url /v3/JS/key/events', body: 'x' }));
    assert.equal(p.$('#list li .url')!.textContent, 'not a url /v3/JS/key/events');
  });

  it('collapses every expand', () => {
    const p = loadPanel();
    p.request(entry({
      body: {
        events: [ev({ custom_attributes: { a: 1 } })],
        consent_state: { gdpr: { parking: { consented: true } } },
      },
    }));

    assert.ok(p.$$<HTMLDetailsElement>('#list details').some((d) => d.open));
    p.click('collapse');
    assert.ok(p.$$<HTMLDetailsElement>('#list details').every((d) => !d.open));
  });

  it('clears the list', () => {
    const p = loadPanel();
    p.request(entry({ body: 'x' }));
    p.click('clear');
    assert.equal(p.$$('#list li').length, 0);
    assert.equal(p.$('#count')!.textContent, '0');
  });

  it('clears on navigation unless the log is preserved', () => {
    const p = loadPanel();
    p.request(entry({ body: 'x' }));
    p.navigate();
    assert.equal(p.$$('#list li').length, 0);

    p.request(entry({ body: 'x' }));
    p.$<HTMLInputElement>('#preserve')!.checked = true;
    p.navigate();
    assert.equal(p.$$('#list li').length, 1);
    assert.equal(p.$('#count')!.textContent, '1');
  });
});

describe('instance selector', () => {
  const options = (p: Panel) => [...p.$<HTMLSelectElement>('#instance')!.options].map((o) => o.value);
  const withInstances = (names: string[]) => fakeMp({ instances: Object.fromEntries(names.map((n) => [n, fakeMp()])) });

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
    assert.equal(p.$<HTMLSelectElement>('#instance')!.value, 'a');
  });

  it('falls back to default_instance when the selection disappears', () => {
    const p = loadPanel({ mParticle: withInstances(['default_instance', 'a', 'b']) });
    p.setInstance('a');
    p.page.mParticle = withInstances(['default_instance', 'b']);
    p.clickTab('forwarders');
    assert.deepEqual(options(p), ['default_instance', 'b']);
    assert.equal(p.$<HTMLSelectElement>('#instance')!.value, 'default_instance');
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
    Object.defineProperty(p.page, 'mParticle', {
      get() {
        throw new Error('x');
      },
    });
    p.clickTab('forwarders');
    assert.deepEqual(options(p), ['default_instance', 'a', 'b']);
  });

  it('reads forwarders from the selected instance', () => {
    const p = loadPanel({
      mParticle: fakeMp({
        forwarders: [{ name: 'Default kit', id: 1, initialized: true }],
        instances: {
          default_instance: fakeMp({ forwarders: [{ name: 'Default kit', id: 1, initialized: true }] }),
          a: fakeMp({ forwarders: [{ name: 'A kit', id: 2, initialized: true }] }),
        },
      }),
    });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-list .name')!.textContent, 'Default kit');
    p.setInstance('a');
    assert.equal(p.$('#fwd-list .name')!.textContent, 'A kit');
  });

  it('falls back to window.mParticle when _instances has no default_instance', () => {
    const p = loadPanel({
      mParticle: fakeMp({
        forwarders: [{ name: 'Root kit', id: 1, initialized: true }],
        instances: { a: fakeMp({ forwarders: [] }) },
      }),
    });
    p.clickTab('forwarders');
    assert.equal(p.$<HTMLSelectElement>('#instance')!.value, 'default_instance');
    assert.equal(p.$('#fwd-list .name')!.textContent, 'Root kit');
  });

  it('re-runs the visible tab loader on change', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [{ name: 'First', id: 1, initialized: true }] }) });
    p.clickTab('forwarders');
    p.page.mParticle = fakeMp({ forwarders: [{ name: 'Second', id: 2, initialized: true }] });
    p.setInstance('default_instance');
    assert.equal(p.$('#fwd-list .name')!.textContent, 'Second');
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

    assert.equal(p.$('#fwd-status')!.textContent, '2 forwarder(s)');
    const [ga, braze] = p.$$('#fwd-list li');
    assert.equal(ga.querySelector('.name')!.textContent, 'GA4');
    assert.deepEqual(
      [...ga.querySelectorAll('.meta div')].map((d) => d.textContent),
      ['GA4', 'id: 160', 'initialized'],
    );
    assert.ok(ga.querySelector('.meta div:last-child')!.classList.contains('ok'));
    assert.equal(ga.querySelector('pre')!.textContent, JSON.stringify(kits[0], null, 2));
    assert.equal(ga.querySelector('details summary')!.textContent, 'settings (1)');
    assert.deepEqual([...ga.querySelectorAll('.kv .k')].map((e) => e.textContent), ['apiKey']);

    assert.equal(braze.querySelector('.meta div:last-child')!.textContent, 'not initialized');
    assert.ok(braze.querySelector('.meta div:last-child')!.classList.contains('err'));
  });

  it('reports an empty list', () => {
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [] }) });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status')!.textContent, 'No active forwarders');
    assert.equal(p.$$('#fwd-list li').length, 0);
  });

  it('reports a missing instance', () => {
    const p = loadPanel();
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status')!.textContent, 'instance not found on page');
  });

  it('reports a throwing _getActiveForwarders', () => {
    const mp = fakeMp();
    mp._getActiveForwarders = () => {
      throw new Error('boom');
    };
    const p = loadPanel({ mParticle: mp });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status')!.textContent, 'Error: boom');
  });

  it('drops functions from the settings', () => {
    const p = loadPanel({
      mParticle: fakeMp({
        forwarders: [{ name: 'GA4', id: 160, initialized: true, settings: { apiKey: 'k', onLoad() {} } }],
      }),
    });
    p.clickTab('forwarders');
    const raw = p.$('#fwd-list pre')!.textContent!;
    assert.ok(raw.includes('apiKey'));
    assert.ok(!raw.includes('onLoad'));
  });

  it('still renders a forwarder whose settings are circular', () => {
    const settings: Record<string, unknown> = { apiKey: 'k' };
    settings.self = settings;
    const p = loadPanel({ mParticle: fakeMp({ forwarders: [{ name: 'GA4', id: 160, initialized: true, settings }] }) });
    p.clickTab('forwarders');

    const li = p.$('#fwd-list li')!;
    assert.equal(li.querySelector('.name')!.textContent, 'GA4');
    assert.equal(li.querySelectorAll('.meta div')[1].textContent, 'id: 160');
    assert.ok(JSON.parse(li.querySelector('pre')!.textContent!).error);
  });

  it('reports a failed eval', () => {
    const p = loadPanel({ mParticle: fakeMp() });
    Object.defineProperty(p.page, 'mParticle', {
      get() {
        throw new Error('x');
      },
    });
    p.clickTab('forwarders');
    assert.equal(p.$('#fwd-status')!.textContent, 'eval failed: Error: x');
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

    assert.equal(p.$('#id-status')!.textContent, '');
    const [head, body] = p.$$('#id-list li');
    assert.deepEqual(
      [...head.querySelectorAll('.meta div')].map((d) => d.textContent),
      ['MPID: mpid-1', 'device: das-1', 'logged in'],
    );
    assert.ok(head.querySelector('.meta div:last-child')!.classList.contains('ok'));

    assert.deepEqual(labels(body), ['identities (2)', 'user attributes (1)', 'consent']);
    assert.deepEqual(
      [...detail(body, 'identities (2)').querySelector('.kv')!.children].map((c) => c.textContent),
      ['email', 'a@b.c', 'customerid', '42'],
    );
    assert.equal(
      detail(body, 'consent').querySelector('pre')!.textContent,
      JSON.stringify({ gdpr: { parking: { consented: true } } }, null, 2),
    );
  });

  it('marks a logged out user', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: fakeUser({ loggedIn: false }) }) });
    p.clickTab('identity');
    const state = p.$('#id-list .meta div:last-child')!;
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
    user.getMPID = () => {
      throw new Error('nope');
    };
    const p = loadPanel({ mParticle: fakeMp({ user }) });
    p.clickTab('identity');
    assert.equal(p.$('#id-list .name')!.textContent, 'MPID: Error: nope');
  });

  it('reports no current user', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: null }) });
    p.clickTab('identity');
    assert.equal(p.$('#id-status')!.textContent, 'no current user');
    assert.equal(p.$$('#id-list li').length, 0);
  });

  it('reports a missing instance', () => {
    const p = loadPanel();
    p.clickTab('identity');
    assert.equal(p.$('#id-status')!.textContent, 'instance not found on page');
  });

  it('re-renders on refresh', () => {
    const p = loadPanel({ mParticle: fakeMp({ user: fakeUser({ mpid: 'one' }) }) });
    p.clickTab('identity');
    p.page.mParticle = fakeMp({ user: fakeUser({ mpid: 'two' }) });
    p.click('id-refresh');
    assert.equal(p.$('#id-list .name')!.textContent, 'MPID: two');
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
