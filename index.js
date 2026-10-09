const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const TARGET_URL = process.env.TARGET_URL;
const BTN_TEXT = process.env.BTN_TEXT || '开始测试';

if (!TARGET_URL) {
  process.exit(1);
}

async function fetchToken() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1366,768'
    ]
  });

  let token = null;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

    await page.evaluateOnNewDocument(() => {
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        try {
          if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            if (parsed && parsed.token && String(parsed.token).startsWith('eyJ')) {
              window.__CAPTURED_TOKEN__ = parsed.token;
            }
          }
        } catch (_) {}
        return origSend.apply(this, arguments);
      };
    });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 35000 });

    const inputSelector = 'input[type="text"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    const inputEl = await page.$(inputSelector);

    await inputEl.click({ clickCount: 3 });
    await inputEl.type('1.1.1.1', { delay: 60 });

    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate((keyword) => {
      const candidates = Array.from(document.querySelectorAll('button, .el-button, a, div[role="button"]'));
      const realBtn = candidates.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes(keyword) && !b.querySelector('button');
      });

      if (realBtn) {
        realBtn.click();
        return;
      }

      const allEls = Array.from(document.querySelectorAll('*')).reverse();
      const leaf = allEls.find(el => (el.innerText || el.textContent || '').trim() === keyword || (el.innerText || '').includes(keyword));
      if (leaf) {
        leaf.click();
      }
    }, BTN_TEXT);

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 500));
      token = await page.evaluate(() => window.__CAPTURED_TOKEN__);
      if (token) break;
    }

  } finally {
    await browser.close().catch(() => {});
  }

  if (!token) {
    throw new Error('FAILED');
  }

  return token;
}

(async () => {
  try {
    const token = await fetchToken();
    fs.writeFileSync('token.txt', token.trim(), 'utf-8');
    process.exit(0);
  } catch (err) {
    process.exit(1);
  }
})();
