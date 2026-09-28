const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function fetchAntping(browser) {
  console.log(`[${new Date().toISOString()}] >>> 开始抓取站点 1: antping.com...`);
  const page = await browser.newPage();
  let token = null;

  try {
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

    await page.goto('https://antping.com/ping', { waitUntil: 'networkidle2', timeout: 35000 });
    console.log('antping 页面已加载，准备触发测速...');

    const inputSelector = 'input[type="text"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    const inputEl = await page.$(inputSelector);
    await inputEl.click({ clickCount: 3 });
    await inputEl.type('1.1.1.1', { delay: 50 });

    await new Promise(r => setTimeout(r, 800));

    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, .el-button, a, div[role="button"]'));
      const realBtn = candidates.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('开始测试') && !b.querySelector('button');
      });
      if (realBtn) {
        realBtn.click();
        return;
      }
      const allEls = Array.from(document.querySelectorAll('*')).reverse();
      const leaf = allEls.find(el => (el.innerText || el.textContent || '').trim() === '开始测试');
      if (leaf) leaf.click();
    });

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 500));
      token = await page.evaluate(() => window.__CAPTURED_TOKEN__);
      if (token) break;
    }
  } finally {
    await page.close().catch(() => {});
  }

  if (token) {
    console.log(`✅ antping 捕获成功: ${token.slice(0, 30)}...`);
  } else {
    console.warn('⚠️ antping 未能在等待时间内截获 Token');
  }
  return token;
}

async function fetchTcptest(browser) {
  console.log(`[${new Date().toISOString()}] >>> 开始抓取站点 2: tcptest.cn...`);
  const page = await browser.newPage();
  
  const result = {
    site: 'www.tcptest.cn',
    protocol: 'WebSocket',
    report_id: '',
    wss_url: '',
    api_url: '/api/v2/tasks',
    auth_tokens: {
      task_id: '',
      cancel_token: ''
    },
    raw_payload: ''
  };

  try {
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');

    cdp.on('Network.webSocketCreated', ({ url }) => {
      console.log('⚡ [CDP 核心捕获] WebSocket 连接已建立:', url);
      result.wss_url = url;
      const match = String(url).match(/task_id=([a-f0-9-]+)/i);
      if (match) {
        result.auth_tokens.task_id = match[1];
      }
    });

    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      if (response && response.payloadData && !result.raw_payload) {
        result.raw_payload = response.payloadData;
      }
    });

    cdp.on('Network.responseReceived', async ({ response, requestId }) => {
      if (response.url.includes('/api/v2/tasks') || response.url.includes('/tasks')) {
        try {
          const bodyObj = await cdp.send('Network.getResponseBody', { requestId });
          if (bodyObj && bodyObj.body) {
            const json = JSON.parse(bodyObj.body);
            const targetObj = (json.data && typeof json.data === 'object') ? json.data : json;
            if (targetObj.task_id) result.auth_tokens.task_id = targetObj.task_id;
            if (targetObj.cancel_token) result.auth_tokens.cancel_token = targetObj.cancel_token;
            console.log('⚡ [CDP 核心捕获] 任务鉴权参数已获取:', result.auth_tokens.task_id);
          }
        } catch (_) {}
      }
    });

    await page.goto('https://www.tcptest.cn/ping/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    console.log('tcptest 页面加载完成，准备寻找目标输入框...');

    await page.waitForFunction(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.some(i => i.offsetWidth > 100);
    }, { timeout: 15000 });

    const targetInputHandle = await page.evaluateHandle(() => {
      const inputs = Array.from(document.querySelectorAll('input')).filter(i => {
        const type = (i.type || 'text').toLowerCase();
        return !['checkbox', 'radio', 'hidden', 'file'].includes(type) && i.offsetWidth > 100;
      });

      const matched = inputs.find(i => {
        const p = (i.placeholder || '').toLowerCase();
        return p.includes('ip') || p.includes('域名') || p.includes('host') || p.includes('地址');
      });

      return matched || inputs[0];
    });

    const targetInput = targetInputHandle.asElement();
    if (!targetInput) {
      throw new Error('未能在 tcptest 页面中定位到测速目标输入框');
    }

    await targetInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await targetInput.type('1.1.1.1', { delay: 40 });
    console.log('已输入测试目标: 1.1.1.1，正在执行多重触发...');

    await new Promise(r => setTimeout(r, 600));

    await page.keyboard.press('Enter');

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, .el-button, input[type="submit"], [role="button"]'));
      const validButtons = buttons.filter(b => {
        if (b.closest('header, nav, .header, .nav, .navbar, .menu')) return false;
        const text = (b.innerText || b.textContent || b.value || '').trim();
        return /^(开始测试|立即测试|立即检测|测速|Ping|PING|开始)$/.test(text) ||
               text.includes('开始测试') || text.includes('立即检测') || text.includes('立即测速');
      });

      if (validButtons.length > 0) {
        validButtons[0].click();
      }
    });

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (result.auth_tokens.task_id && (result.auth_tokens.cancel_token || result.wss_url)) {
        break;
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  if (!result.wss_url && result.auth_tokens.task_id) {
    result.wss_url = `wss://www.tcptest.cn/ws/v1/client?task_id=${result.auth_tokens.task_id}`;
  }

  if (result.auth_tokens.task_id) {
    console.log(`✅ tcptest 捕获成功: task_id=${result.auth_tokens.task_id}`);
    return result;
  } else {
    console.warn('⚠️ tcptest 未能在等待时间内截获 task_id');
    return null;
  }
}

(async () => {
  console.log(`[${new Date().toISOString()}] 启动浏览器实例执行多源 Token 同步...`);
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

  let antpingToken = null;
  let tcptestTokens = null;

  try {
    try {
      antpingToken = await fetchAntping(browser);
    } catch (e) {
      console.error('antping 任务执行异常:', e.message);
    }

    try {
      tcptestTokens = await fetchTcptest(browser);
    } catch (e) {
      console.error('tcptest 任务执行异常:', e.message);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  let oldLines = [];
  if (fs.existsSync('token.txt')) {
    oldLines = fs.readFileSync('token.txt', 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
  }

  const finalAntping = antpingToken ? antpingToken.trim() : (oldLines[0] || '');
  const finalTcptest = tcptestTokens ? JSON.stringify(tcptestTokens) : (oldLines[1] || '');

  const combinedContent = `${finalAntping}\n${finalTcptest}`.trim();
  fs.writeFileSync('token.txt', combinedContent, 'utf-8');
  console.log('✅ 已将全部站点凭据写入 token.txt（第1行 antping，第2行 tcptest）');

  if (antpingToken || tcptestTokens || finalAntping) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();
