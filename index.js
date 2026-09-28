const puppeteer = require('puppeteer');

async function fetchToken() {
  console.log(`[${new Date().toISOString()}] 启动无头浏览器准备捕获 Token...`);

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

    // 注入底层 WebSocket 劫持逻辑
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

    // 输入测试目标触发握手
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

  console.log(`[成功] 捕获到有效 Token: ${token.slice(0, 30)}...`);
  return token;
}

async function uploadToCloudflareKV(token) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!accountId || !namespaceId || !apiToken) {
    throw new Error('缺少必要的 Cloudflare 环境变量配置');
  }

  const kvKey = 'LIVE_TOKEN';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${kvKey}`;

  console.log('正在向 Cloudflare Workers KV 同步最新 Token...');

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'text/plain'
    },
    body: token
  });

  const resData = await resp.json();
  if (resData.success) {
    console.log('✅ Token 已成功同步至 Cloudflare KV (键名: LIVE_TOKEN)！');
  } else {
    throw new Error('同步写入 KV 失败: ' + JSON.stringify(resData));
  }
}

(async () => {
  try {
    const token = await fetchToken();
    await uploadToCloudflareKV(token);
    process.exit(0);
  } catch (err) {
    console.error('❌ 执行失败:', err.message);
    process.exit(1);
  }
})();
