import { describe, it } from '@std/testing/bdd';
import assert from 'node:assert/strict';
import { classify, type RequestEntry } from '../src/requests.ts';

const STARTED = '2026-01-02T03:04:05.000Z';

const req = (url: string, body?: unknown, startedDateTime = STARTED): RequestEntry => ({
  startedDateTime,
  request: {
    url,
    postData: body === undefined ? undefined : { text: typeof body === 'string' ? body : JSON.stringify(body) },
  },
});

const kind = (url: string, body?: unknown) => classify(req(url, body))?.kind ?? null;

function mustClassify(entry: RequestEntry) {
  const c = classify(entry);
  assert.ok(c);
  return c;
}

describe('filter', () => {
  it('ignores URLs that do not match', () => {
    assert.equal(classify(req('https://example.com/other')), null);
  });

  it('matches case-insensitively', () => {
    assert.equal(kind('https://x.test/V2/JS/key/Events', 'x'), 'other');
  });

  it('matches the default v3 upload URL', () => {
    assert.equal(
      kind('https://jssdks.mparticle.com/v3/JS/us2-cbf324c983a1464a8cef51328faad173/events', {
        events: [{ event_type: 'custom_event' }],
      }),
      'batch',
    );
  });

  it('matches the identity endpoints', () => {
    assert.equal(kind('https://identity.mparticle.com/v1/identify', 'x'), 'other');
    assert.equal(kind('https://identity.mparticle.com/v1/login', 'x'), 'other');
    assert.equal(kind('https://identity.mparticle.com/v1/1234/modify', 'x'), 'other');
  });

  it('matches the config endpoint', () => {
    assert.equal(kind('https://jssdkcdns.mparticle.com/JS/v2/key/config', 'x'), 'other');
  });

  it('ignores a path with no version segment', () => {
    assert.equal(classify(req('https://example.com/events', 'x')), null);
  });

  it('ignores an events path without a JS key segment', () => {
    assert.equal(classify(req('https://example.com/v2/other/events', 'x')), null);
  });

  it('matches an identity request body', () => {
    assert.equal(
      kind('https://identity.mparticle.com/v1/identify', { known_identities: { email: 'a@b.c' } }),
      'identity',
    );
  });
});

describe('hide /Forwarding', () => {
  const forwarding = (url: string, opts?: { hideForwarding?: boolean }) => classify(req(url, 'x'), opts);

  it('drops /Forwarding and /Forwarding?x=1 while checked', () => {
    assert.equal(forwarding('https://example.com/v2/JS/key/Forwarding', { hideForwarding: true }), null);
    assert.equal(forwarding('https://example.com/v2/JS/key/Forwarding?x=1', { hideForwarding: true }), null);
  });

  it('shows them when unchecked', () => {
    assert.ok(forwarding('https://example.com/v2/JS/key/Forwarding', { hideForwarding: false }));
    assert.ok(forwarding('https://example.com/v2/JS/key/Forwarding'));
  });

  it('never drops /ForwardingX', () => {
    assert.ok(forwarding('https://example.com/v2/JS/key/ForwardingX', { hideForwarding: true }));
  });
});

describe('shapes', () => {
  const EVENTS_URL = 'https://jssdks.mparticle.com/v3/JS/key/events';
  const ID_URL = 'https://mp-data.gofundme.com/identity/v1/login';

  it('classifies a batch, one row per event, with the batch data split out', () => {
    const c = mustClassify(req(EVENTS_URL, {
      mpid: '1',
      events: [
        { event_type: 'custom_event', data: { timestamp_unixtime_ms: 1789440092105 } },
        { event_type: 'session_start', data: {} },
      ],
    }));

    assert.ok(c.kind === 'batch');
    assert.deepEqual(c.batch, { mpid: '1' });
    assert.deepEqual(c.rows.map((r) => r.when), [1789440092105, STARTED]);
    assert.equal(c.rows[0].event.event_type, 'custom_event');
  });

  it('classifies an identity request by its op and timestamp', () => {
    const c = mustClassify(req(`${ID_URL}?x=1`, { request_timestamp_ms: 42, known_identities: { email: 'a@b.c' } }));
    assert.ok(c.kind === 'identity');
    assert.equal(c.op, 'login');
    assert.equal(c.when, 42);
    assert.deepEqual(c.request.known_identities, { email: 'a@b.c' });
  });

  it('falls back to the request time when the identity request has no timestamp', () => {
    const c = mustClassify(req(ID_URL, { known_identities: {} }));
    assert.ok(c.kind === 'identity');
    assert.equal(c.when, STARTED);
  });

  it('classifies anything else as other, keeping the parsed body', () => {
    const c = mustClassify(req(EVENTS_URL, { mpid: '123' }));
    assert.ok(c.kind === 'other');
    assert.deepEqual(c.body, { mpid: '123' });
    assert.equal(c.when, STARTED);
  });

  it('keeps a non-JSON body as the raw string', () => {
    const c = mustClassify(req(EVENTS_URL, 'not json at all'));
    assert.ok(c.kind === 'other');
    assert.equal(c.body, 'not json at all');
  });

  it('leaves the body undefined when there is no post body', () => {
    const c = mustClassify(req(EVENTS_URL));
    assert.ok(c.kind === 'other');
    assert.equal(c.body, undefined);
  });
});
