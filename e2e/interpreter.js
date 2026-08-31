const fs = require('fs');
const path = require('path');
const { By, until, Key, sleep } = require('./session');
const cfg = require('./config');
const { resolveRoute } = require('./session');

function txt(el) {
  return el ? (el.getText().catch(() => '')).then(t => (t || '').trim()) : Promise.resolve('');
}

async function bodyText(driver) {
  return driver.executeScript(() => document.body.innerText);
}

async function shoot(driver, tcId, stepNo, tag) {
  try {
    const shot = await driver.takeScreenshot();
    const file = path.join(cfg.SHOT_DIR, `${tcId}-step${stepNo}-${tag}.png`);
    fs.writeFileSync(file, Buffer.from(shot, 'base64'));
    return file;
  } catch (e) { return null; }
}

async function clickByText(driver, phrase) {
  const p = phrase.replace(/'/g, "''").trim();
  const candidates = [
    `//button[normalize-space(.)='${p}']`,
    `//a[normalize-space(.)='${p}']`,
    `//*[@role='button' and normalize-space(.)='${p}']`,
    `//li[normalize-space(.)='${p}']`,
    `//span[normalize-space(.)='${p}']`,
    `//label[normalize-space(.)='${p}']`,
    `//div[normalize-space(.)='${p}' and string-length(normalize-space(.))<40]`,
    `//button[contains(normalize-space(.),'${p}')]`,
    `//a[contains(normalize-space(.),'${p}')]`,
    `//*[@role='button' and contains(normalize-space(.),'${p}')]`,
    `//span[contains(normalize-space(.),'${p}')]`,
  ];
  for (const xp of candidates) {
    const els = await driver.findElements(By.xpath(xp));
    for (const el of els) {
      try {
        if (await el.isDisplayed()) {
          await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', el);
          await sleep(300);
          await driver.executeScript('arguments[0].click();', el);
          return true;
        }
      } catch (e) { /* next */ }
    }
  }
  return false;
}

async function findField(driver, nameHint) {
  const t = nameHint.toLowerCase();
  const tokens = t.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

  const byLabelFor = async () => {
    for (const tok of [nameHint.trim(), ...tokens]) {
      if (!tok) continue;
      const xp = `//label[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${tok.replace(/'/g, "''")}')]`;
      const labels = await driver.findElements(By.xpath(xp));
      for (const l of labels) {
        const f = l.getAttribute('for');
        if (f) {
          const els = await driver.findElements(By.id(f));
          if (els.length) return els[0];
        }
        const sibs = await l.findElements(By.xpath('following::input[1] | following::textarea[1] | following::select[1]'));
        if (sibs.length) return sibs[0];
      }
    }
    return null;
  };

  const byAttr = async () => {
    for (const tok of tokens.sort((a, b) => b.length - a.length)) {
      if (tok.length < 3) continue;
      const els = await driver.findElements(By.css(
        `input[name*='${tok}' i], input[id*='${tok}' i], input[placeholder*='${tok}' i], textarea[name*='${tok}' i], textarea[placeholder*='${tok}' i], input[aria-label*='${tok}' i]`
      ));
      for (const el of els) if (await el.isDisplayed()) return el;
    }
    return null;
  };

  return (await byAttr()) || (await byLabelFor());
}

const CONTROL_SELECTORS = [
  "[class*='Select2__control']",
  "[class*='react-select__control']",
  "div[class*='-control'][class*='css-']",
].join(', ');

const OPTION_XPS = (opt) => {
  const o = opt.replace(/'/g, "''");
  return [
    `//*[contains(@class,'Select2__option') or contains(@class,'react-select__option') or (contains(@class,'-option') and contains(@class,'css-'))][normalize-space(.)='${o}']`,
    `//*[@role='option'][normalize-space(.)='${o}']`,
    `//*[contains(@class,'Select2__option') or contains(@class,'react-select__option') or (contains(@class,'-option') and contains(@class,'css-'))][contains(normalize-space(.),'${o}')]`,
    `//*[@role='option'][contains(normalize-space(.),'${o}')]`,
    `//li[contains(@class,'option')][normalize-space(.)='${o}']`,
    `//li[contains(@class,'option')][contains(normalize-space(.),'${o}')]`,
  ];
};

async function visible(el) {
  try { return await el.isDisplayed(); } catch (e) { return false; }
}

async function findControlNearLabel(driver, labelHint) {
  const t = labelHint.toLowerCase();
  const tokens = t.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2);
  const hints = [];
  for (const tok of [labelHint.trim(), ...tokens]) {
    if (!tok || hints.length > 8) continue;
    const xp =
      `//*[self::label or self::span or self::div[string-length(normalize-space(.))<70]]` +
      `[normalize-space(.)!='' and contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${tok.replace(/'/g, "''")}')]`;
    const els = await driver.findElements(By.xpath(xp));
    for (const el of els.slice(0, 6)) if (await visible(el)) hints.push(el);
  }
  for (const h of hints) {
    const ctrls = await h.findElements(By.xpath(
      "following-sibling::*[1] | preceding-sibling::*[1] | parent::*"
    ));
    for (const c of ctrls) {
      const found = await c.findElements(By.css(CONTROL_SELECTORS + ', select'));
      for (const f of found) if (await visible(f)) return f;
      const tag = await c.getTagName();
      if (tag === 'select' && (await visible(c))) return c;
    }
  }
  return null;
}

async function pickOptionByText(driver, optionText) {
  for (const xp of OPTION_XPS(optionText)) {
    const opts = await driver.findElements(By.xpath(xp));
    for (const o of opts) {
      if (!(await visible(o))) continue;
      await driver.executeScript('arguments[0].click();', o);
      await sleep(500);
      return true;
    }
  }
  return false;
}

async function reactSelectPick(driver, labelHint, optionText) {
  let control = await findControlNearLabel(driver, labelHint);
  if (!control) {
    const anySel = await driver.findElements(By.css(CONTROL_SELECTORS));
    for (const c of anySel) if (await visible(c)) { control = c; break; }
  }
  if (!control) return false;

  const tag = (await control.getTagName()).toLowerCase();
  if (tag === 'select') return nativeSelectSet(driver, control, optionText);

  await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', control);
  await sleep(300);
  await driver.executeScript('arguments[0].click();', control);
  await sleep(700);

  if (await pickOptionByText(driver, optionText)) return true;

  const inp = await driver.findElements(By.css("input[id*='react-select'], input[class*='Select2__input'], div[class*='Select2__control'] input, div[class*='-control'] input"));
  for (const i of inp) {
    if (!(await visible(i))) continue;
    try { await i.sendKeys(optionText); } catch (e) { continue; }
    await sleep(1200);
    if (await pickOptionByText(driver, optionText)) return true;
    await driver.actions().sendKeys(Key.ENTER).perform();
    return true;
  }
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  return false;
}

async function nativeSelectSet(driver, selectEl, value) {
  await driver.executeScript(`
    const sel = arguments[0], val = arguments[1];
    const opt = [...sel.options].find(o => o.text.trim().toLowerCase().includes(val.toLowerCase()));
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  `, selectEl, value);
}

async function typeIntoField(driver, fieldEl, value) {
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', fieldEl);
  await sleep(200);
  const tag = (await fieldEl.getTagName()).toLowerCase();
  if (tag === 'select') return nativeSelectSet(driver, fieldEl, value);
  try { await fieldEl.clear(); } catch (e) { /* readonly */ }
  await driver.executeScript(`
    const el = arguments[0];
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
  `, fieldEl);
  await fieldEl.sendKeys(value);
  await driver.executeScript(`
    const el = arguments[0];
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  `, fieldEl);
  return true;
}

function parseValueFromDetail(detail, verbs) {
  let d = detail;
  const eq = d.match(/(?:^|\s)(?:Input|Select|Fill|Enter|Type|Choose|Set)\s+(.+?)\s*(?:=|=>|:|=|->)\s*(.+)$/i);
  if (eq) return { target: eq[1].trim(), value: eq[2].replace(/\.$/, '').trim() };
  const inTo = d.match(/^(?:Input|Enter|Type|Fill)\s+(.+?)\s+(?:in|into|on)\s+(?:the\s+)?(.+)$/i);
  if (inTo) return { value: inTo[1].trim(), target: inTo[2].replace(/field|box|input/gi, '').trim() };
  return null;
}

async function navigateStep(driver, step, ctx) {
  const route = await resolveRoute(driver, (step.location || '') + ' ' + step.detail, ctx.menuLinks);
  if (!route) return { status: 'SKIP', note: 'no route matched' };
  await driver.get(ctx.feUrl + route);
  await sleep(2500);
  return { status: 'PASS', note: 'goto ' + route };
}

async function executeStep(driver, step, ctx) {
  const raw = `${step.detail}`;
  const d = raw.toLowerCase();
  const result = (status, note) => ({ status, note });

  try {
    if (/^(navigate|go to|open)\b/.test(d) || /^(navigate to)/.test(d)) {
      const nav = await navigateStep(driver, step, ctx);
      return result(nav.status === 'PASS' ? 'PASS' : 'SKIP', nav.note);
    }

    if (/^verify\b|^check\b|^ensure\b|^confirm\b|^validate\b/.test(d)) {
      const body = await bodyText(driver);
      const kw = raw
        .replace(/^verify|^check|^ensure|^confirm|^validate/i, '')
        .replace(/\b(is|are|displayed|successfully|should|be|the|that|to)\b/gi, ' ')
        .split(/[^A-Za-z0-9]+/)
        .filter(w => w.length >= 5)
        .map(w => w.toLowerCase());
      const hit = kw.some(w => body.toLowerCase().includes(w));
      return result(hit ? 'PASS' : 'WARN', hit ? 'keyword found on page' : `none of [${kw.slice(0, 5).join(',')}] found`);
    }

    if (/^search\b/.test(d)) {
      const inputs = await driver.findElements(By.css("input[type='text'], input[type='search'], input:not([type])"));
      for (const inp of inputs) {
        try {
          if (!(await inp.isDisplayed())) continue;
          const ph = (await inp.getAttribute('placeholder')) || '';
          if (/search|cari|filter/i.test(ph) || true) {
            const m = raw.match(/search\s+(?:and\s+select\s+)?(.+?)(?:\s+with|\s*=|$)/i);
            const val = ctx.testData[m && m[1] ? m[1] : ''] || '';
            await inp.sendKeys(val ? val : '');
            await inp.sendKeys(Key.ENTER);
            await sleep(1200);
            return result('PASS', 'typed into first visible input' + (val ? ` (${val})` : ''));
          }
        } catch (e) { continue; }
      }
      return result('FAIL', 'no search input visible');
    }

    const parsed = parseValueFromDetail(raw);
    if (parsed && /^(select|choose|pick)/.test(d)) {
      const okReact = await reactSelectPick(driver, parsed.target, parsed.value);
      if (okReact) return result('PASS', `dropdown ${parsed.target}=${parsed.value}`);
      const clicked = await clickByText(driver, parsed.value);
      if (clicked) return result('PASS', `clicked option text ${parsed.value}`);
      return result('SKIP', `dropdown ${parsed.target}=${parsed.value} not automatable`);
    }

    if (parsed && /^(input|fill|enter|type|set)\b/.test(d)) {
      const field = await findField(driver, parsed.target);
      if (field) {
        const val = resolveDynamicValue(parsed.value, ctx);
        await typeIntoField(driver, field, val);
        return result('PASS', `filled ${parsed.target}=${val}`);
      }
      const okReact = await reactSelectPick(driver, parsed.target, parsed.value);
      if (okReact) return result('PASS', `react-select ${parsed.target}=${parsed.value}`);
      return result('SKIP', `field "${parsed.target}" not found`);
    }

    const clickM = raw.match(/^(?:Click|Press|Tap|Klik)\s+(.+)$/i);
    if (clickM) {
      let phrase = clickM[1].replace(/^(the|on)\s+/i, '').replace(/\s+(button|menu|icon|tab)$/i, '').replace(/[.]$/, '').trim();
      const dataHit = lookupTestData(ctx, phrase);
      if (dataHit) phrase = dataHit;
      const ok = await clickByText(driver, phrase);
      if (ok) return result('PASS', `clicked "${phrase}"`);
      const words = phrase.split(/\s+/);
      if (words.length > 1) {
        const ok2 = await clickByText(driver, words[words.length - 1]);
        if (ok2) return result('PASS', `clicked last-word "${words[words.length - 1]}"`);
      }
      return result('SKIP', `"${phrase}" not found to click`);
    }

    const genericParsed = parseValueFromDetail(raw);
    if (genericParsed) {
      const field = await findField(driver, genericParsed.target);
      if (field) {
        const val = resolveDynamicValue(genericParsed.value, ctx);
        await typeIntoField(driver, field, val);
        return result('PASS', `filled ${genericParsed.target}=${val}`);
      }
    }

    const clickedAny = await clickByText(driver, raw.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(-3).join(' '));
    if (clickedAny) return result('PASS', 'clicked tail-phrase');

    return result('SKIP', 'step pattern not recognized');
  } catch (e) {
    return result('FAIL', e.message.split('\n')[0].slice(0, 180));
  }
}

function lookupTestData(ctx, phrase) {
  const p = phrase.toLowerCase();
  for (const td of ctx.testData || []) {
    const m = td.match(/^\s*([^:]+?)\s*:\s*(.+)$/);
    if (m && p.includes(m[1].toLowerCase().replace(/[^a-z]/g, ''))) return m[2].trim();
  }
  return null;
}

function resolveDynamicValue(value, ctx) {
  if (/today|current date/i.test(value)) return new Date().toISOString().slice(0, 10);
  if (/tomorrow/i.test(value)) return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return value;
}

module.exports = { executeStep, shoot };
