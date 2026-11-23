import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(ROOT, 'logs');
if (!fs.existsSync(LOG)) fs.mkdirSync(LOG, { recursive: true });

const stamp = () => new Date().toLocaleString('zh-CN', { hour12: false });
const log = (...a) => {
  const line = `${stamp()} ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG, 'sign.log'), line + '\r\n', 'utf8');
};

const cfgPath = path.join(ROOT, 'config.json');
if (!fs.existsSync(cfgPath)) {
  log('缺少 config.json，请先运行 setup.ps1 填写学号和密码');
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const USER = cfg.username;
const PASS = cfg.password;
const ACC = String(cfg.accuracy ?? 10);
const HEADLESS = cfg.headless !== false;

if (!USER || !PASS) {
  log('config.json 里 username / password 不能为空');
  process.exit(2);
}

let browser;
try {
  // ---------- 1. 启动并登录 ----------
  browser = await chromium.launch({
    channel: 'msedge',
    headless: HEADLESS,
    args: ['--disable-gpu', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  await p.goto('https://xskq.ahut.edu.cn/', { timeout: 45000, waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 20000 });
  await p.fill('input[placeholder="请输入用户名"]', USER);
  await p.fill('input[placeholder="请输入密码"]', PASS);
  await p.click('button:has-text("登 录")');
  await p.waitForFunction(() => !!localStorage.getItem('access-token'), null, { timeout: 30000 });
  await p.waitForTimeout(1500);

  const st = await p.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('access-token'));
    const pl = JSON.parse(atob(o.content.split('.')[1]));
    return { len: o.content.length, exp: pl.exp, left: Math.round((pl.exp * 1000 - Date.now()) / 60000) };
  });
  log('登录成功 token长度', st.len, '剩余', st.left, '分钟');

  // ---------- 2. 页面内 API 封装 ----------
  const api = async (apiPath, body) => {
    return await p.evaluate(async ({ apiPath, body }) => {
      const url = performance.getEntriesByType('resource')
        .map(e => e.name).find(n => n.includes('js-md5'));
      if (!url) return { error: 'js-md5 module not found' };
      const mod = await import(url);
      const md5 = mod.m;
      const tok = JSON.parse(localStorage.getItem('access-token')).content;
      const ts = Date.now();
      const inner = md5.md5(ts + tok);
      const base = apiPath.split('?')[0];
      const sign = md5.md5(base + '?sign=' + inner) + '1.' + btoa(ts.toString());
      const o = {
        method: body ? 'POST' : 'GET',
        headers: {
          'flysource-auth': 'bearer ' + tok,
          'flysource-sign': sign,
          'Content-Type': 'application/json'
        }
      };
      if (body) o.body = JSON.stringify(body);
      const r = await fetch(apiPath, o);
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: r.status, json, text: text.slice(0, 400) };
    }, { apiPath, body });
  };

  // ---------- 3. 取任务 ----------
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  log('今天', today);

  const list = await api('/api/flySource-yxgl/dormSignTask/getStudentTaskPage?current=1&size=10');
  if (!list.json || list.json.code !== 200) {
    log('取任务失败', list.status, list.text);
    process.exit(3);
  }
  const records = list.json.data?.records || [];
  const task = records.find(t => t.taskStatus === 1) || records[0];
  if (!task) { log('没有可用任务'); process.exit(4); }
  const taskId = task.taskId;
  log('任务', task.taskName || task.name || '(无名)', taskId);

  // ---------- 4. 是否已签到 ----------
  const rec = await api(`/api/flySource-yxgl/dormSignRecord/getOne?taskId=${taskId}&signDate=${today}`);
  if (rec.json?.code === 200 && rec.json.data && rec.json.data.signTime) {
    log('今天已签到，时间', rec.json.data.signTime, '—— 跳过');
    process.exit(0);
  }
  log('未签到，继续');

  // ---------- 5. 取围栏（坐标用接口返回值，不用硬编码） ----------
  const detail = await api(`/api/flySource-yxgl/dormSignTask/getTaskByIdForApp?taskId=${taskId}&signDate=${today}`);
  if (!detail.json || detail.json.code !== 200) {
    log('取任务详情失败', detail.status, detail.text);
    process.exit(5);
  }
  const d = detail.json.data;
  const room = d.dormitoryRegisterVO || {};
  if (!room.roomId || !room.locationLat) {
    log('任务详情里没有宿舍围栏数据，可能未分配宿舍');
    process.exit(5);
  }
  const lat = String(room.locationLat);
  const lng = String(room.locationLng);
  log('窗口', d.signStartTime, '-', d.signEndTime, '| 围栏半径', d.locationAccuracy, '米');
  log('房号', room.roomId, '| 围栏中心', lat, lng);

  // ---------- 6. 构造并提交 ----------
  const payload = await p.evaluate(({ taskId, today, lat, lng, acc, roomId, scanType }) => {
    const url = performance.getEntriesByType('resource')
      .map(e => e.name).find(n => n.includes('js-md5'));
    return import(url).then(mod => {
      const md5 = mod.m;
      const n = {
        latitude: lat.toString(),
        longitude: lng.toString(),
        locationAccuracy: acc.toString(),
        signDate: today,
        taskId: taskId,
        fileId: ''
      };
      return {
        signType: 0,
        taskId: taskId,
        signLat: lat,
        signLng: lng,
        locationAccuracy: acc,
        stuTaskId: md5.md5(JSON.stringify(n)),
        scanCode: '',
        scanType: scanType || '',
        roomId: roomId,
        signKey: roomId.toString(),
        signCode: md5.md5(new Date().toString())
      };
    });
  }, { taskId, today, lat, lng, acc: ACC, roomId: room.roomId, scanType: d.scanType });

  log('提交中...');
  const res = await api('/api/flySource-yxgl/dormSignRecord/stuSign', payload);

  if (res.json?.code === 200) {
    log('签到成功');
    process.exit(0);
  } else {
    log('签到失败:', res.json?.msg || res.text);
    process.exit(6);
  }
} catch (e) {
  log('异常:', e.message);
  process.exit(1);
} finally {
  if (browser) await browser.close();
}