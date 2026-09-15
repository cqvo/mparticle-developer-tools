// Opt-in end-to-end test: `deno task e2e`. Launches real Chrome with dist/ loaded and visibly opens a window.
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd';
import assert from 'node:assert/strict';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { entry, loadPanel } from '../test/harness.ts';

const SITES = [
  { url: 'https://www.mparticle.com/', mparticle: true },
  { url: 'https://www.google.com/', mparticle: false }, // control: must show nothing
];
const DIST = new URL('../dist/', import.meta.url).pathname;
// mirrors URL_FILTER in src/panel.ts
const FILTER = /\/v[1-3]\/(identify|login|logout|.+\/modify|.+\/config|.+\/Forwarding|JS\/[^/]+\/events)/i;
const NEXT_PANEL = Deno.build.os === 'darwin' ? 'Meta' : 'Control';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll until `fn` returns something truthy, or give up after `ms`.
async function until<T>(ms: number, fn: () => T | Promise<T>): Promise<T | undefined> {
  for (let waited = 0; waited <= ms; waited += 500) {
    const v = await fn();
    if (v) return v;
    await wait(500);
  }
}

// Show the mParticle panel in the real DevTools window, reload the page, and return a reader for the panel's DOM.
async function openPanel(browser: Browser, page: Page): Promise<(expr: string) => Promise<unknown>> {
  const devtools = await until(10_000, () => browser.targets().find((t) => t.url().endsWith('/devtools.html')));
  assert.ok(devtools, 'extension devtools page never loaded; check dist/ and manifest.json');

  const frontendTarget = await until(
    10_000,
    () => browser.targets().find((t) => t.url().startsWith('devtools://')),
  );
  assert.ok(frontendTarget, 'DevTools frontend target never appeared');

  // The panel is only instantiated once DevTools shows it, so cycle panels until its target appears.
  const frontend = await frontendTarget.asPage();
  const panel = await until(12_000, async () => {
    await frontend.keyboard.down(NEXT_PANEL);
    await frontend.keyboard.press(']');
    await frontend.keyboard.up(NEXT_PANEL);
    return browser.targets().find((t) => t.url().endsWith('/panel.html'));
  });
  assert.ok(panel, 'could not show mParticle panel');

  // The SDK caches its identity, so a plain reload emits nothing for the now-open panel to see.
  await (await page.createCDPSession()).send('Network.clearBrowserCookies');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 });

  const cdp = await panel.createCDPSession(); // asPage() throws for a panel target ("main frame too early")
  const read = async (expr: string) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return result.value;
  };
  return read;
}

for (const { url, mparticle } of SITES) {
  describe(url, () => {
    let browser: Browser;
    let page: Page;
    const captured: { url: string; method: string; status: number; body?: string }[] = [];

    beforeAll(async () => {
      browser = await puppeteer.launch({
        channel: 'chrome',
        headless: false,
        devtools: true, // auto-opens DevTools per tab, which is what instantiates our panel
        defaultViewport: null,
        enableExtensions: [DIST],
        pipe: true, // required by puppeteer to load an unpacked extension by path
        args: ['--no-first-run'],
      });
      [page] = await browser.pages();
      page.on('requestfinished', (r) => {
        if (!FILTER.test(r.url())) return;
        captured.push({ url: r.url(), method: r.method(), status: r.response()!.status(), body: r.postData() });
      });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
      if (!mparticle) {
        await wait(5_000); // control site: nothing to wait for, just give stragglers a chance to show up
      } else if (!(await until(20_000, () => captured.length > 0))) {
        // The SDK only batches on a 10s timer, upload(), or a commerce event; force a flush before giving up.
        await page.evaluate('window.mParticle?.upload?.()');
        await until(10_000, () => captured.length > 0);
      }
    });

    afterAll(() => browser?.close());

    if (mparticle) {
      it('emits mParticle traffic that the panel code renders', () => {
        assert.ok(captured.length > 0, `no request matching ${FILTER} on ${url}`);
        assert.ok(captured.some((r) => r.body), `no request body captured on ${url}: ${captured.map((r) => r.url)}`);

        const p = loadPanel();
        for (const r of captured) p.request(entry(r));
        assert.ok(p.$$('#list li').length > 0, `panel rendered no rows for ${captured.length} requests from ${url}`);
      });

      it('renders events in the real DevTools panel', async () => {
        const read = await openPanel(browser, page);
        const countRows = () => read(`document.querySelectorAll('#list li').length`);
        let rows = await until(30_000, countRows);
        if (!rows) {
          await read(`document.getElementById('upload').click()`); // Force Batch Upload, same fallback as stage 1
          rows = await until(10_000, countRows);
        }
        assert.ok(rows, `panel showed no rows after reloading ${url}, even after a forced upload`);
        assert.ok(
          Number(await read(`document.getElementById('count').textContent`)) > 0,
          'panel count is not positive',
        );
      });
    } else {
      it('sends no requests matching the mParticle filter', () => {
        assert.equal(
          captured.length,
          0,
          `unexpected requests matching ${FILTER} on ${url}: ${captured.map((r) => r.url)}`,
        );
      });

      it('leaves the DevTools panel empty', async () => {
        const read = await openPanel(browser, page);
        await wait(5_000); // give the panel a chance to (wrongly) render something
        assert.equal(await read(`document.querySelectorAll('#list li').length`), 0, `panel rendered rows for ${url}`);
        assert.equal(
          await read(`document.getElementById('count').textContent`),
          '0',
          `panel count is not 0 for ${url}`,
        );
      });
    }
  });
}
