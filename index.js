const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// 启用完全指纹伪装，移除 webdriver 特征
puppeteer.use(StealthPlugin());

// 从环境变量读取敏感参数（防窥探）
const TARGET_URL = process.env.TARGET_URL;
const BTN_TEXT = process.env.BTN_TEXT || '开始测试';

if (!TARGET_URL) {
  console.error('❌ 未检测到 TARGET_URL 环境变量，请在 Secrets 中配置');
  process.exit(1);
}

async function fetchToken() {
  console.log(`[${new Date().toISOString()}] 启动隐身浏览器准备捕获 Token...`);

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

    // 1. 深度劫持 WebSocket 消息帧
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

    console.log('正在打开目标页面...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 35000 });
    console.log('页面加载完成');

    // 2. 精准定位文本输入框（排除复选框）
    const inputSelector = 'input[type="text"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    const inputEl = await page.\$(inputSelector);

    // 聚焦并输入测试目标 IP
    await inputEl.click({ clickCount: 3 });
    await inputEl.type('1.1.1.1', { delay: 60 });
    console.log('已输入测试目标: 1.1.1.1');

    await new Promise(r => setTimeout(r, 1000));

    // 3. 精准点击测试按钮（通过环境变量动态匹配）
    const clickSuccess = await page.evaluate((keyword) => {
      // 优先从 button 或具有点击特性的元素中找
      const candidates = Array.from(document.querySelectorAll('button, .el-button, a, div[role="button"]'));
      const realBtn = candidates.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes(keyword) && !b.querySelector('button');
      });

      if (realBtn) {
        realBtn.click();
        return '点击了候选按钮';
      }

      // 兜底：反向查找最底层的叶子节点
      const allEls = Array.from(document.querySelectorAll('*')).reverse();
      const leaf = allEls.find(el => (el.innerText || el.textContent || '').trim() === keyword || (el.innerText || '').includes(keyword));
      if (leaf) {
        leaf.click();
        return '点击了文本叶子节点';
      }

      return '未找到目标按钮';
    }, BTN_TEXT);

    console.log('按钮触发结果:', clickSuccess);

    // 4. 轮询捕获 Token（最长等待 25 秒）
    for (let i = 0; i < 50; i++) {
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
    console.log('✅ Token 已成功保存至本地 token.txt');
    process.exit(0);
  } catch (err) {
    console.error('❌ 执行失败:', err.message);
    process.exit(1);
  }
})();
