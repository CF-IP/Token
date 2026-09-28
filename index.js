const fs = require('fs');
const puppeteer = require('puppeteer');

async function fetchToken() {
  console.log(`[${new Date().toISOString()}] 启动浏览器准备捕获 Token...`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  let token = null;

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

    // 劫持底层 WebSocket 发送数据包
    await page.evaluateOnNewDocument(() => {
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        try {
          if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            if (parsed && parsed.token && parsed.token.startsWith('eyJ')) {
              window.__CAPTURED_TOKEN__ = parsed.token;
            }
          }
        } catch (_) {}
        return origSend.apply(this, arguments);
      };
    });

    await page.goto('https://antping.com/ping', { waitUntil: 'networkidle2', timeout: 35000 });

    await page.waitForSelector('input', { timeout: 10000 });
    await page.type('input', '1.1.1.1');

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, div, span'));
      const testBtn = buttons.find(el => el.textContent && el.textContent.includes('开始测试'));
      if (testBtn) testBtn.click();
    });

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      token = await page.evaluate(() => window.__CAPTURED_TOKEN__);
      if (token) break;
    }

  } finally {
    await browser.close().catch(() => {});
  }

  if (!token) {
    throw new Error('未能在规定时间内截获到有效 Token');
  }

  return token;
}

(async () => {
  try {
    const token = await fetchToken();
    fs.writeFileSync('token.txt', token.trim(), 'utf-8');
    console.log(`✅ Token 已成功保存至本地 token.txt: ${token.slice(0, 30)}...`);
    process.exit(0);
  } catch (err) {
    console.error('❌ 执行失败:', err.message);
    process.exit(1);
  }
})();
