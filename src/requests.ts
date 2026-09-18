// Pure request classification for the panel: URL filtering and body-shape detection, with no DOM or chrome APIs so it
// can be unit-tested directly. Unlike probes.ts this is never shipped to the page, so module-level values are fine.

export interface MpEvent {
  event_type?: string;
  data?: {
    event_name?: string;
    screen_name?: string;
    application_transition_type?: string;
    product_action?: { action?: string } | null;
    timestamp_unixtime_ms?: number;
    custom_attributes?: Record<string, unknown>;
    custom_flags?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

export interface IdentityRequest {
  request_timestamp_ms?: number;
  known_identities?: Record<string, unknown>;
}

// The parts of a chrome.devtools.network.Request classification needs.
export interface RequestEntry {
  startedDateTime: string;
  request: { url: string; postData?: { text?: string } };
}

export const URL_FILTER = /\/v[1-3]\/(identify|login|logout|.+\/modify|.+\/config|.+\/Forwarding|JS\/[^/]+\/events)/i;
const FORWARDING = /\/Forwarding(\?|$)/;

export type Classified =
  | { kind: 'batch'; batch: Record<string, unknown>; rows: { event: MpEvent; when: string | number }[] }
  | { kind: 'identity'; op: string; when: string | number; request: IdentityRequest }
  // body undefined => caller renders the query string
  | { kind: 'other'; when: string; body: unknown };

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseBody(entry: RequestEntry): unknown {
  const text = entry.request.postData && entry.request.postData.text;
  if (!text) return undefined;
  return parseJson(text);
}

export function classify(entry: RequestEntry, opts?: { hideForwarding?: boolean }): Classified | null {
  const url = entry.request.url;
  if (!URL_FILTER.test(url)) return null;
  if (opts?.hideForwarding && FORWARDING.test(url)) return null;

  const body = parseBody(entry);

  if (typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events)) {
    const { events, ...batch } = body as { events: MpEvent[] } & Record<string, unknown>;
    return {
      kind: 'batch',
      batch,
      rows: events.map((event) => ({
        event,
        when: (event.data && event.data.timestamp_unixtime_ms) || entry.startedDateTime,
      })),
    };
  }

  if (typeof body === 'object' && body !== null && 'known_identities' in body) {
    const request = body as IdentityRequest;
    return {
      kind: 'identity',
      op: url.split('?')[0].split('/').pop()!,
      when: request.request_timestamp_ms || entry.startedDateTime,
      request,
    };
  }

  return { kind: 'other', when: entry.startedDateTime, body };
}
