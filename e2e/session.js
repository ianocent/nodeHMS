const puppeteer = require('puppeteer-core');
const cfg = require('./config');

class By {
  constructor(mode, sel) { this.mode = mode; this.sel = sel; }
  static id(v) { return new By('id', v); }
  static css(v) { return new By('css', v); }
  static xpath(v) { return new By('xpath', v); }
}

const Key = { ENTER: '\ue007', ESCAPE: '\ue00c', TAB: '\ue004' };

const until = {
  elementLocated: by => driver => driver.findElementOrNull(by),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

async function buildDriver() {
  let executablePath = CHROME_PATHS.find(p => { try { return require('fs').existsSync(p); } catch (e) { return false; } });
  let browser;
  const opts = {
    headless: cfg.HEADLESS,
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
  };
  try {
    browser = await puppeteer.launch({ ...opts, channel: 'chrome', executablePath });
  } catch (e) {
    if (!executablePath) throw new Error(`Cannot launch Chrome. Install Google Chrome or set CHROME_PATH. (${e.message})`);
    browser = await puppeteer.launch({ ...opts, executablePath });
  }
  const page = (await browser.pages())[0] || await browser.newPage();
  return new DriverShim(browser, page);
}

function registerNodeExpr() {
  return `
    window.__e2eSeq = window.__e2eSeq || 0;
    window.__e2eReg = (node) => {
      let hid = node.getAttribute && node.getAttribute('data-e2e-hid');
      if (!hid) {
        hid = 'h' + (++window.__e2eSeq);
        try { node.setAttribute('data-e2e-hid', hid); } catch (e) { return null; }
      }
      return hid;
    };
  `;
}

function evalWithArgs(fnSrc, argTokens, isFn) {
  const bind = isFn
    ? `const __fn = (${fnSrc});`
    : `const __fn = function () { ${fnSrc} };`;
  return `
    (() => {
      ${registerNodeExpr()}
      const __tok2el = (t) => t == null ? null : document.querySelector('[data-e2e-hid="' + t + '"]');
      const __args = ${JSON.stringify(argTokens)}.map(t => typeof t === 'object' && t !== null && t.__e2eToken ? __tok2el(t.__e2eToken) : t);
      ${bind}
      return __fn.apply(null, __args);
    })()
  `;
}

function serializeArgs(args) {
  return args.map(a => (a instanceof ElementHandle ? { __e2eToken: a.token } : a));
}

class DriverShim {
  constructor(browser, page) {
    this.browser = browser;
    this.page = page;
    this._implicit = 4000;
  }

  async get(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(e => {
      throw new Error(`navigation failed: ${e.message}`);
    });
    await sleep(500);
  }

  async manage() {
    const self = this;
    return {
      setTimeouts: async ({ implicit } = {}) => { if (implicit != null) self._implicit = implicit; },
    };
  }

  async executeScript(fn, ...args) {
    const isFn = typeof fn === 'function';
    const src = isFn ? fn.toString() : String(fn);
    return this.page.evaluate(evalWithArgs(src, serializeArgs(args), isFn));
  }

  async findElements(by, ctxToken = null) {
    const deadline = Date.now() + this._implicit;
    let out = [];
    do {
      out = await this._findElementsInner(by, ctxToken);
      if (out.length) return out;
      await sleep(150);
    } while (Date.now() < deadline);
    return out;
  }

  async _findElementsInner(by, ctxToken) {
    const { mode, sel } = by;
    const tokens = await this.page.evaluate((payload) => {
      window.__e2eSeq = window.__e2eSeq || 0;
      const reg = (node) => {
        if (!node || !node.setAttribute) return null;
        let hid = node.getAttribute('data-e2e-hid');
        if (!hid) { hid = 'h' + (++window.__e2eSeq); node.setAttribute('data-e2e-hid', hid); }
        return hid;
      };
      const ctx = payload.ctxToken ? document.querySelector('[data-e2e-hid="' + payload.ctxToken + '"]') : null;
      const nodes = [];
      try {
        if (payload.mode === 'xpath') {
          const snap = document.evaluate(payload.sel, ctx || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < snap.snapshotLength; i++) nodes.push(snap.snapshotItem(i));
        } else if (payload.mode === 'css') {
          const root = ctx || document;
          nodes.push(...(ctx ? Array.from(ctx.querySelectorAll(payload.sel)) : Array.from(document.querySelectorAll(payload.sel))));
        } else if (payload.mode === 'id') {
          const n = document.getElementById(payload.sel);
          if (n) nodes.push(n);
        }
      } catch (e) { return []; }
      return nodes.map(reg).filter(Boolean);
    }, { mode, sel, ctxToken }).catch(() => []);
    return tokens.map(t => new ElementHandle(this.page, t));
  }

  async findElementOrNull(by, ctxToken = null) {
    const els = await this._findElementsInner(by, ctxToken);
    for (const el of els) if (await el.isDisplayed()) return el;
    return els[0] || null;
  }

  async findElement(by, ctxToken = null) {
    const deadline = Date.now() + this._implicit;
    let el = null;
    while (Date.now() < deadline) {
      el = await this.findElementOrNull(by, ctxToken);
      if (el) return el;
      await sleep(200);
    }
    throw new Error(`no such element: ${by.mode}:${by.sel}`);
  }

  async wait(condFn, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = await condFn(this);
      if (v) return v;
      await sleep(250);
    }
    throw new Error(`wait timed out after ${timeout}ms`);
  }

  async actions() {
    const self = this;
    let keys = [];
    return {
      sendKeys: async (...ks) => { keys.push(...ks.flat()); return this; },
      perform: async () => {
        for (const k of keys) {
          await self.page.keyboard.press(k === Key.ENTER ? 'Enter' : k === Key.ESCAPE ? 'Escape' : k === Key.TAB ? 'Tab' : k);
        }
        keys = [];
        return this;
      },
    };
  }

  async takeScreenshot() {
    return this.page.screenshot({ encoding: 'base64' });
  }

  async quit() {
    await this.browser.close().catch(() => {});
  }
}

class ElementHandle {
  constructor(page, token) {
    this.page = page;
    this.token = token;
  }

  async _eval(fn, ...args) {
    const isFn = typeof fn === 'function';
    const src = isFn ? fn.toString() : String(fn);
    return this.page.evaluate(evalWithArgs(src, [{ __e2eToken: this.token }, ...args], isFn));
  }

  async isDisplayed() {
    try {
      return await this._eval((el) => !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
    } catch (e) { return false; }
  }

  async getText() {
    try { return String((await this._eval(el => el.innerText || el.textContent || '')) || '').trim(); }
    catch (e) { return ''; }
  }

  async getAttribute(name) {
    try { return await this._eval((el, n) => (n === 'for' ? el.htmlFor || el.getAttribute('for') : el.getAttribute(n)), name); }
    catch (e) { return null; }
  }

  async getTagName() {
    try { return await this._eval(el => el.tagName.toLowerCase()); }
    catch (e) { return ''; }
  }

  async click() {
    await this._eval(el => { el.scrollIntoView({ block: 'center' }); el.click(); });
    return true;
  }

  async clear() {
    await this._eval((el) => {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async sendKeys(text) {
    await this._eval((el, t) => {
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      const cur = el.value || '';
      setter.call(el, cur + t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: t.length === 1 ? t : 'Unidentified', bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(text));
  }

  async findElements(by) {
    const shim = new DriverShim(null, this.page);
    return shim._findElementsInner(by, this.token);
  }

  async findElement(by) {
    const shim = new DriverShim(null, this.page);
    const els = await shim._findElementsInner(by, this.token);
    for (const el of els) if (await el.isDisplayed()) return el;
    if (els[0]) return els[0];
    throw new Error(`no such element (relative): ${by.mode}:${by.sel}`);
  }
}

function toLoopback(url) {
  return url.replace('//localhost:', '//127.0.0.1:');
}

async function waitForServer(url, label, timeoutMs = 90000) {
  const target = toLoopback(url);
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(3000) });
      if (res.status < 600) {
        console.log(`[e2e] ${label} OK (${target}, status ${res.status}, attempt ${attempt})`);
        return true;
      }
    } catch (e) { /* retry */ }
    if (attempt % 5 === 1) {
      console.log(`[e2e] waiting for ${label} at ${target}... (attempt ${attempt})`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(
    `${label} NOT reachable at ${target} after ${timeoutMs / 1000}s.\n` +
    `Start servers first:  node watchlogs.js   (in backend-node)\n` +
    `Then re-run:          npm run e2e`
  );
}

async function login(driver) {
  await driver.get(cfg.FRONTEND_URL + '/dashboard');
  const email = await driver.wait(until.elementLocated(By.id('email')), 30000);
  await email.clear();
  await email.sendKeys(cfg.USERNAME);
  const pass = await driver.findElement(By.id('signin-password'));
  await pass.clear();
  await pass.sendKeys(cfg.PASSWORD);
  const btn = await driver.wait(
    until.elementLocated(By.xpath("//button[.//*[contains(normalize-space(.),'Login')] or normalize-space(.)='Login']")),
    10000
  );
  await btn.click();
  await driver.wait(async d => d.page.url().includes('/choose-property'), 45000).catch(() => {});
  await sleep(1500);
}

async function startShift(driver) {
  await driver.get(cfg.FRONTEND_URL + '/dashboard');
  await sleep(3500);
  const startXp = "//button[normalize-space(.)='START SHIFT']";
  const endXp = "//button[normalize-space(.)='END SHIFT']";
  let btn = await driver.findElementOrNull(By.xpath(startXp));
  if (!btn) {
    const already = await driver.findElementOrNull(By.xpath(endXp));
    console.log(already ? '[e2e] shift already active (END SHIFT visible)' : '[e2e] shift not required for this user/property');
    return;
  }
  await driver.executeScript('arguments[0].click();', btn);
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    if (await driver.findElementOrNull(By.xpath(endXp))) {
      console.log('[e2e] shift started (button now END SHIFT)');
      return;
    }
    btn = await driver.findElementOrNull(By.xpath(startXp));
    if (!btn) {
      console.log('[e2e] shift started (START SHIFT gone)');
      return;
    }
  }
  throw new Error('clicked START SHIFT but it never became END SHIFT — check backend response for POST /cms/shift/start');
}

async function chooseProperty(driver) {
  const nameXp = "//h2[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'" +
    cfg.PROPERTY_NAME.toLowerCase() + "')]";
  const codeXp = "//*[contains(text(),'" + cfg.PROPERTY_CODE + "')]";

  for (let pageNo = 0; pageNo < 15; pageNo++) {
    let card = await driver.findElementOrNull(By.xpath(nameXp)) || await driver.findElementOrNull(By.xpath(codeXp));
    if (!card) {
      const nextBtn = await driver.findElementOrNull(
        By.xpath("//button[normalize-space(.)='Next' and not(@disabled)]")
      );
      if (!nextBtn) break;
      await driver.executeScript('arguments[0].click();', nextBtn);
      await sleep(2000);
      continue;
    }
    await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', card);
    await sleep(400);
    await driver.executeScript('arguments[0].click();', card);
    await sleep(2500);
    console.log(`[e2e] property selected: ${cfg.PROPERTY_NAME}`);
    return;
  }
  throw new Error(`property "${cfg.PROPERTY_NAME}" (${cfg.PROPERTY_CODE}) not found after pagination`);
}

const STATIC_ROUTES = [
  ['reservation fit', '/reservation/fit'],
  ['new fit', '/reservation/fit'],
  ['day use', '/reservation/day-use'],
  ['booking case day use', '/reservation/day-use'],
  ['git', '/reservation/git'],
  ['virtual reservation', '/reservation/vr'],
  ['floor plan', '/front-desk'],
  ['front desk - folio', '/front-desk/folio'],
  ['folio', '/front-desk/folio'],
  ['check-in', '/front-desk/check-in'],
  ['check in', '/front-desk/check-in'],
  ['check-out', '/front-desk/check-out'],
  ['check out', '/front-desk/check-out'],
  ['batch posting', '/front-desk/batch-posting'],
  ['batch check out', '/front-desk/batch-check-out'],
  ['virtual folio', '/front-desk/virtual-folio'],
  ['housekeeping', '/house-keeping'],
  ['house keeping', '/house-keeping'],
  ['room statistic', '/room-statistic'],
  ['room availability', '/room-statistic'],
  ['guest', '/guest'],
  ['concierge', '/concierge'],
  ['event', '/event'],
  ['master venue', '/master-venue'],
  ['master setup', '/master-setup'],
  ['rate management', '/rate-management'],
  ['accounting', '/accounting'],
  ['reporting', '/reporting'],
  ['profile', '/profile'],
  ['user', '/user'],
  ['role', '/role'],
  ['permission', '/permission'],
  ['settings', '/settings'],
  ['night audit', '/night-audit'],
  ['endshift', '/endshift'],
  ['end of day', '/end-of-day'],
  ['end shift', '/endshift'],
  ['system balance', '/system-balance'],
  ['pos transactions', '/pos-transactions'],
  ['staah', '/staah'],
  ['dashboard', '/dashboard'],
  ['reservation', '/reservation/fit'],
];

function scoreMatch(needles, hay) {
  const h = hay.toLowerCase();
  let score = 0;
  for (const n of needles) if (h.includes(n)) score += n.length;
  return score;
}

async function resolveRoute(driver, text, menuLinks) {
  const tokens = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['page', 'menu', 'the', 'via'].includes(t));
  let best = null, bestScore = 0;
  for (const [label, href] of Object.entries(menuLinks || {})) {
    const s = scoreMatch(tokens, label + ' ' + href);
    if (s > bestScore) { bestScore = s; best = href; }
  }
  for (const [key, route] of STATIC_ROUTES) {
    const s = scoreMatch(tokens, key);
    if (s > bestScore) { bestScore = s; best = route; }
  }
  return bestScore >= Math.max(4, Math.min(...tokens.map(t => t.length))) ? best : (best || null);
}

async function scrapeMenuLinks(driver) {
  return driver.executeScript(() => {
    const map = {};
    document.querySelectorAll('a[href]').forEach(a => {
      const t = (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ');
      const href = a.getAttribute('href');
      if (!t || !href || href.startsWith('http') || href === '#') return;
      if (!map[t]) map[t] = href;
    });
    return map;
  });
}

module.exports = { buildDriver, waitForServer, login, chooseProperty, startShift, scrapeMenuLinks, resolveRoute, sleep, By, until, Key };
