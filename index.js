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

    await page.evaluateOnNewDocument(() => {
      const origWS = window.WebSocket;
      window.WebSocket = function (url, protocols) {
        try {
          window.__TCPTEST_WSS_URL__ = url;
          const match = String(url).match(/task_id=([a-f0-9-]+)/i);
          if (match) {
            window.__TCPTEST_TASK_ID__ = match[1];
          }
        } catch (_) {}
        const ws = new origWS(url, protocols);
        const origSend = ws.send;
        ws.send = function (data) {
          try {
            window.__TCPTEST_RAW_PAYLOAD__ = typeof data === 'string' ? data : '';
          } catch (_) {}
          return origSend.apply(this, arguments);
        };
        return ws;
      };
      window.WebSocket.prototype = origWS.prototype;
    });

    page.on('response', async (response) => {
      try {
        const u = response.url();
        if (u.includes('/api/v2/tasks') || u.includes('/tasks')) {
          const json = await response.json();
          if (json) {
            if (json.task_id) result.auth_tokens.task_id = json.task_id;
            if (json.cancel_token) result.auth_tokens.cancel_token = json.cancel_token;
            if (json.data && typeof json.data === 'object') {
              if (json.data.task_id) result.auth_tokens.task_id = json.data.task_id;
              if (json.data.cancel_token) result.auth_tokens.cancel_token = json.data.cancel_token;
            }
          }
        }
      } catch (_) {}
    });

    await page.goto('https://www.tcptest.cn/ping/', { waitUntil: 'networkidle2', timeout: 35000 });
    console.log('tcptest 页面加载完成，准备定位输入框...');

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
        return (text.includes('开始测试') || text.includes('立即检测') || text.includes('Ping') || text.includes('开始')) && !b.querySelector('button');
      });
      if (realBtn) {
        realBtn.click();
        return;
      }
      const allEls = Array.from(document.querySelectorAll('*')).reverse();
      const leaf = allEls.find(el => {
        const text = (el.innerText || el.textContent || '').trim();
        return text === '开始测试' || text === '开始检测' || text === 'Ping';
      });
      if (leaf) leaf.click();
    });

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 500));
      const pageCaptured = await page.evaluate(() => ({
        wss: window.__TCPTEST_WSS_URL__ || '',
        taskId: window.__TCPTEST_TASK_ID__ || '',
        payload: window.__TCPTEST_RAW_PAYLOAD__ || ''
      }));

      if (pageCaptured.wss && !result.wss_url) result.wss_url = pageCaptured.wss;
      if (pageCaptured.taskId && !result.auth_tokens.task_id) result.auth_tokens.task_id = pageCaptured.taskId;
      if (pageCaptured.payload && !result.raw_payload) result.raw_payload = pageCaptured.payload;

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

  if (antpingToken) {
    fs.writeFileSync('token.txt', antpingToken.trim(), 'utf-8');
    console.log('📦 [保持完全兼容] token.txt 已更新');
  }

  if (tcptestTokens) {
    fs.writeFileSync('tcptest_token.json', JSON.stringify(tcptestTokens, null, 2), 'utf-8');
    console.log('📦 [新增站点凭据] tcptest_token.json 已更新');
  }

  const combined = {
    updated_at: Math.floor(Date.now() / 1000),
    antping: antpingToken || '',
    tcptest: tcptestTokens || null
  };
  fs.writeFileSync('tokens.json', JSON.stringify(combined, null, 2), 'utf-8');
  console.log('📦 [多源凭据总池] tokens.json 已更新');

  if (antpingToken || tcptestTokens) {
    console.log('🎉 任务完成，至少成功同步一个站点的 Token。');
    process.exit(0);
  } else {
    console.error('❌ 全部目标站点均未捕获到 Token');
    process.exit(1);
  }
})();
