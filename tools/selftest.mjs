/**
 * 冒烟测试：用 Chrome DevTools Protocol 真按键驱动游戏，验证核心循环。
 * 运行：node tools\selftest.mjs
 * 退出码 0 = 全部通过。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const PAGE_URL = process.argv[2] || 'file:///D:/github/platformer/index.html?play=1';
const OUT_DIR = 'D:\\github\\platformer\\_selftest';

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'pchrome-'));
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('about:') && !t.url.startsWith('chrome'));
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('未找到调试目标');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const VK = { ArrowRight: 39, ArrowLeft: 37, Space: 32, KeyR: 82, ArrowDown: 40 };
async function keyDown(c, code) {
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: code, code, windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code]
  });
}
async function keyUp(c, code) {
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: code, code, windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code]
  });
}

async function evalJSON(c, expr) {
  const r = await c.send('Runtime.evaluate', {
    expression: `JSON.stringify((() => { const s = window.GAME ? window.GAME.scene.getScene('play') : null; ${expr} })())`,
    returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' / ' + (r.exceptionDetails.exception?.description || ''));
  const raw = r.result.value;
  return raw ? JSON.parse(raw) : null;
}

const STATE = `if (!s || !s.player) return { ready: false };
  return { ready: true, x: s.player.x, y: s.player.y,
    vx: s.player.body.velocity.x, vy: s.player.body.velocity.y,
    onFloor: !!(s.player.body.blocked.down || s.player.body.touching.down),
    coins: s.registry.get('coins'), deaths: s.registry.get('deaths'),
    level: s.levelIndex, dead: s.isDead, done: s.completed };`;

async function shot(c, name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${udd}`,
  '--window-size=1000,620',
  PAGE_URL
], { stdio: 'ignore' });

let client;
try {
  const target = await waitForTarget();
  client = makeClient(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  /* 等待 Phaser 加载完、play 场景创建好（线上地址要等 1.3MB 引擎下载） */
  let st = null;
  for (let i = 0; i < 40; i++) {
    st = await evalJSON(client, STATE).catch(() => null);
    if (st && st.ready) break;
    await sleep(500);
  }
  await sleep(400);
  st = await evalJSON(client, STATE);
  check('场景启动', !!st && st.ready, st ? `level=${st.level} x=${Math.round(st.x)} y=${Math.round(st.y)}` : 'play 场景未就绪');
  if (!st || !st.ready) throw new Error('游戏未启动');

  const startY = st.y;
  const startX = st.x;

  /* 1. 右移 */
  await keyDown(client, 'ArrowRight');
  await sleep(600);
  const moving = await evalJSON(client, STATE);
  await keyUp(client, 'ArrowRight');
  await sleep(250);
  check('按住 → 向右移动', moving.x - startX > 60, `Δx=${Math.round(moving.x - startX)} vx=${Math.round(moving.vx)}`);
  check('速度达到设计上限附近', moving.vx >= 280, `vx=${Math.round(moving.vx)} / 320`);
  check('松手后刹车', (await evalJSON(client, STATE)).vx <= 30, `vx=${Math.round((await evalJSON(client, STATE)).vx)}`);

  /* 2. 跳跃：全程长按，应升高 > 60px 且落回地面 */
  await keyDown(client, 'Space');
  await sleep(300);
  const apex = await evalJSON(client, STATE);
  await sleep(300);
  const stillHeld = await evalJSON(client, STATE);
  await keyUp(client, 'Space');
  await sleep(900);
  const landed = await evalJSON(client, STATE);
  check('长按空格起跳升高', startY - apex.y > 60, `Δy=${Math.round(startY - apex.y)} (设计 112)`);
  check('起跳后离地', !apex.onFloor, `onFloor=${apex.onFloor}`);
  check('落回地面', landed.onFloor && Math.abs(landed.y - startY) < 6, `y=${Math.round(landed.y)} onFloor=${landed.onFloor}`);

  /* 3. 点按跳（可变高度）应比长按跳明显低 */
  const beforeTap = (await evalJSON(client, STATE)).y;
  await keyDown(client, 'Space');
  await sleep(120);
  await keyUp(client, 'Space');
  await sleep(120);
  const tapApex = await evalJSON(client, STATE);
  await sleep(900);
  const tapPeak = beforeTap - tapApex.y;
  check('松手切高度：点按跳跃更矮', tapPeak > 8 && tapPeak < startY - apex.y, `点按峰值 Δy=${Math.round(tapPeak)}，长按 Δy=${Math.round(startY - apex.y)}`);

  /* 4. 吃金币 */
  const coinBefore = (await evalJSON(client, STATE)).coins;
  await evalJSON(client, `s.player.setPosition(320, 448); s.player.body.reset(320, 448); return {};`);
  await sleep(400);
  const coinAfter = (await evalJSON(client, STATE)).coins;
  check('碰到金币计数 +1', coinAfter === coinBefore + 1, `${coinBefore} → ${coinAfter}`);

  /* 5. 掉进坑（第一关 760~900 是空隙）→ 死亡 + 检查点重生 */
  const deathBefore = (await evalJSON(client, STATE)).deaths;
  await evalJSON(client, `s.player.setPosition(830, 300); s.player.body.reset(830, 300); return {};`);
  await sleep(1800);
  const afterDeath = await evalJSON(client, STATE);
  check('掉坑触发死亡计数', afterDeath.deaths === deathBefore + 1, `deaths ${deathBefore} → ${afterDeath.deaths}`);
  check('死亡后重生回起点', Math.abs(afterDeath.x - 90) < 40, `x=${Math.round(afterDeath.x)}（检查点未激活，应回 90）`);

  /* 6. 检查点：走到检查点 → 存点 → 再死一次应回检查点 */
  await evalJSON(client, `s.player.setPosition(1700, 470); s.player.body.reset(1700, 470); return {};`);
  await sleep(500);
  const cpOk = await evalJSON(client, `const v = s.registry.get('spawn_' + s.levelIndex); return { saved: v ? Math.round(v.x) : null };`);
  check('检查点写入存档', cpOk.saved === 1700, `spawn_x=${cpOk.saved}`);

  await evalJSON(client, `s.player.setPosition(830, 300); s.player.body.reset(830, 300); return {};`);
  await sleep(1800);
  const respawn = await evalJSON(client, STATE);
  check('死后从检查点重生', Math.abs(respawn.x - 1700) < 60, `x=${Math.round(respawn.x)}（期望 ~1700）`);

  const file1 = await shot(client, '01-gameplay');
  console.log('截图:', file1);

  /* 7. 关卡推进：直接把玩家放到终点 → 应进第二关 */
  await evalJSON(client, `const g = s.level.goal; s.player.setPosition(g.x, g.y - 30); s.player.body.reset(g.x, g.y - 30); return {};`);
  await sleep(1600);
  const nextLevel = await evalJSON(client, STATE);
  check('到达终点进入下一关', nextLevel.level === 1 && nextLevel.coins >= 1, `level=${nextLevel.level} coins=${nextLevel.coins}`);
  const file2 = await shot(client, '02-level2');
  console.log('截图:', file2);

  /* 8. 无脚本错误 */
  const errText = await evalJSON(client, `return { text: window.__ERR__ || null };`);
  check('页面无运行时错误浮层', errText.text === null, errText.text || '无');
} catch (e) {
  check('测试脚本执行', false, e.message);
} finally {
  try { client && client.close(); } catch {}
  chrome.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
