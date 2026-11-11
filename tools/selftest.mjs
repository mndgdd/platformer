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
    revivesLeft: s.registry.get('revivesLeft'),
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

  /* 5. 掉进坑（第一关 760~900 是空隙）→ 死亡 → 广告复活面板 */
  const UI = `return { panel: window.__UI__.isRevivePanelOpen(), ad: window.__UI__.isAdPlaying(), skip: window.__UI__.adSkipEnabled(), revives: s.registry.get('revivesLeft') };`;
  const coinNow = (await evalJSON(client, STATE)).coins;
  const deathBefore = (await evalJSON(client, STATE)).deaths;
  await evalJSON(client, `s.player.setPosition(830, 300); s.player.body.reset(830, 300); return {};`);
  await sleep(1600);
  const afterDeath = await evalJSON(client, STATE);
  const ui1 = await evalJSON(client, UI);
  check('掉坑触发死亡计数', afterDeath.deaths === deathBefore + 1, `deaths ${deathBefore} → ${afterDeath.deaths}`);
  check('死亡弹出广告复活面板', ui1.panel === true && afterDeath.dead === true, `panel=${ui1.panel} isDead=${afterDeath.dead}`);
  check('面板显示本关剩余复活次数', ui1.revives === 2, `revivesLeft=${ui1.revives}`);
  console.log('截图:', await shot(client, '05-revive-panel'));

  /* 6. 看广告复活：点按钮 → 广告播放 → 可跳过 → 跳过 → 复活 */
  await evalJSON(client, `window.__UI__.clickReviveAd(); return {};`);
  await sleep(300);
  const ui2 = await evalJSON(client, UI);
  check('点击后进入广告播放', ui2.ad === true && ui2.panel === false, `ad=${ui2.ad}`);
  console.log('截图:', await shot(client, '06-ad-playing'));

  let skipReady = false;
  for (let i = 0; i < 14; i++) {
    const u = await evalJSON(client, UI);
    if (u.skip) { skipReady = true; break; }
    await sleep(500);
  }
  check('广告 5 秒后出现跳过按钮', skipReady, skipReady ? '已可跳过' : '6 秒内未解禁');

  await evalJSON(client, `window.__UI__.clickAdSkip(); return {};`);
  await sleep(900);
  const revived = await evalJSON(client, STATE);
  const ui3 = await evalJSON(client, UI);
  check('看完广告复活成功', revived.dead === false && !ui3.ad && !ui3.panel, `isDead=${revived.dead}`);
  check('复活回到起点（未激活检查点）', Math.abs(revived.x - 90) < 40, `x=${Math.round(revived.x)}`);
  check('复活保留金币', revived.coins === coinNow, `coins=${revived.coins}（复活前 ${coinNow}）`);
  check('复活消耗一次机会', revived.revivesLeft === 1, `revivesLeft=${revived.revivesLeft}`);
  const inv = await evalJSON(client, `return { invincible: s.invincibleUntil > s.time.now };`);
  check('复活后有无敌时间', inv.invincible === true, `剩余 ${Math.round((await evalJSON(client, `return { ms: s.invincibleUntil - s.time.now };`)).ms)} ms`);

  /* 7. 检查点 + 第二次死亡走"直接重来" */
  await evalJSON(client, `s.player.setPosition(1700, 470); s.player.body.reset(1700, 470); return {};`);
  await sleep(500);
  const cpOk = await evalJSON(client, `const v = s.registry.get('spawn_' + s.levelIndex); return { saved: v ? Math.round(v.x) : null };`);
  check('检查点写入存档', cpOk.saved === 1700, `spawn_x=${cpOk.saved}`);

  await evalJSON(client, `s.player.setPosition(830, 300); s.player.body.reset(830, 300); return {};`);
  await sleep(1800);
  const ui4 = await evalJSON(client, UI);
  check('第二次死亡仍给复活机会', ui4.panel === true && ui4.revives === 1, `panel=${ui4.panel} revivesLeft=${ui4.revives}`);

  await evalJSON(client, `window.__UI__.clickReviveCheckpoint(); return {};`);
  await sleep(1200);
  const respawn = await evalJSON(client, STATE);
  check('选择直接重来后从检查点重生', Math.abs(respawn.x - 1700) < 60, `x=${Math.round(respawn.x)}（期望 ~1700）`);

  /* 8. 200 关：总数 + 抽查（含最后一关） */
  const total = await evalJSON(client, `return { n: LEVELS.length, total: typeof TOTAL_LEVELS === 'undefined' ? null : TOTAL_LEVELS };`);
  check('关卡总数 = 200', total.n === 200 && total.total === 200, `LEVELS=${total.n} TOTAL_LEVELS=${total.total}`);

  for (const n of [4, 50, 100, 150, 199, 200]) {
    await evalJSON(client, `s.scene.restart({ level: ${n - 1} }); return {};`);
    await sleep(500);
    const st = await evalJSON(client, `return { level: s.levelIndex, x: s.player.x, y: s.player.y, dead: s.isDead,
      name: s.level.name, width: s.level.width, hasGoal: !!s.goalZone, hasCheckpoint: !!s.checkpointZone };`);
    check(`第 ${n} 关可加载、出生点安全、机关齐备`,
      st.level === n - 1 && !st.dead && st.y < 480 && st.width > 1000 && st.hasGoal === true && st.hasCheckpoint === true,
      `level=${st.level} x=${Math.round(st.x)} y=${Math.round(st.y)} w=${st.width}「${st.name}」`);
  }

  const file1 = await shot(client, '01-gameplay');
  console.log('截图:', file1);

  /* 7. 关卡推进：先把场景复位到第一关（前面的 200 关抽查停在最后一关），
       再把玩家放到终点 → 应进第二关 */
  await evalJSON(client, `s.scene.restart({ level: 0 }); return {};`);
  await sleep(500);
  await evalJSON(client, `const g = s.level.goal; s.player.setPosition(g.x, g.y - 30); s.player.body.reset(g.x, g.y - 30); return {};`);
  await sleep(1600);
  const nextLevel = await evalJSON(client, STATE);
  check('到达终点进入下一关', nextLevel.level === 1 && nextLevel.coins >= 1, `level=${nextLevel.level} coins=${nextLevel.coins}`);
  const file2 = await shot(client, '02-level2');
  console.log('截图:', file2);

  /* 9. 自适应：横屏与竖屏都铺满整块屏（画布 = 视口像素），相机各自换视野 */
  await client.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await sleep(900);
  const land = await evalJSON(client, `const r = document.querySelector('#game canvas').getBoundingClientRect();
    const cam = s.cameras.main;
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
      zoom: +cam.zoom.toFixed(3), sy: Math.round(cam.scrollY),
      pill: document.getElementById('rotate-pill').style.display,
      portrait: window.__UI__.isPortrait() };`);
  check('横屏：画布铺满整块屏（宽高都等于视口）',
    Math.abs(land.w - land.vw) <= 4 && Math.abs(land.h - land.vh) <= 4,
    `${land.w}x${land.h} / 视口 ${land.vw}x${land.vh}`);
  check('横屏：相机按高度铺满世界（zoom=h/540）',
    Math.abs(land.zoom - land.vh / 540) < 0.03, `zoom=${land.zoom} 期望 ${(land.vh / 540).toFixed(3)}`);
  check('横屏：不显示"横屏更爽"按钮', land.pill === 'none', `pill=${land.pill}`);
  check('横屏：不被判定为竖屏', land.portrait === false, `isPortrait=${land.portrait}`);
  const fileLand = await shot(client, '03-landscape-844x390');
  console.log('截图:', fileLand);

  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(900);
  const port = await evalJSON(client, `const r = document.querySelector('#game canvas').getBoundingClientRect();
    const cam = s.cameras.main;
    const viewW = Math.round(cam.width / cam.zoom), viewH = Math.round(cam.height / cam.zoom);
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
      zoom: +cam.zoom.toFixed(3), viewW, viewH, sky: Math.round(viewH - 540), sy: Math.round(cam.scrollY),
      expectSy: Math.round((540 - cam.height / (2 * cam.zoom)) - cam.height / 2),
      useBounds: cam.useBounds, manual: !!s.manualFollow,
      portrait: window.__UI__.isPortrait(), pill: document.getElementById('rotate-pill').style.display,
      running: window.GAME.isRunning, x: s.player.x, level: s.levelIndex };`);
  check('竖屏：画布铺满整块屏（不再是一条 16:9 带子）',
    Math.abs(port.w - port.vw) <= 4 && Math.abs(port.h - port.vh) <= 4,
    `画布 ${port.w}x${port.h} / 视口 ${port.vw}x${port.vh}`);
  check('竖屏：相机换成窄视野（可见世界宽 420~560）',
    port.viewW >= 415 && port.viewW <= 565, `可见世界宽 ${port.viewW} zoom=${port.zoom}`);
  check('竖屏：镜头上方多看到天空（可见高度多出 300px 以上）',
    port.sky > 300, `可见世界高 ${port.viewH}，天空多出 ${port.sky}px`);
  check('竖屏：地面压在屏幕底部（世界 y=540 落在屏幕底边）',
    Math.abs(port.sy - port.expectSy) <= 3 && port.manual === true && port.useBounds === false,
    `scrollY=${port.sy} 期望 ${port.expectSy} manual=${port.manual}`);
  check('竖屏：面板不再拦截（不弹全屏遮罩）', port.portrait === true && port.pill !== 'none', `isPortrait=${port.portrait} pill=${port.pill}`);
  check('竖屏：游戏仍在运行（不是暂停状态）', port.running === true, `GAME.isRunning=${port.running}`);

  const portStart = port.x;
  await keyDown(client, 'ArrowRight');
  await sleep(600);
  const portMoving = await evalJSON(client, STATE);
  await keyUp(client, 'ArrowRight');
  await sleep(250);
  check('竖屏：按键可控（人在竖屏下能走）', portMoving.x - portStart > 60, `Δx=${Math.round(portMoving.x - portStart)} vx=${Math.round(portMoving.vx)}`);
  const portCamX = await evalJSON(client, `return { sx: Math.round(s.cameras.main.scrollX) };`);
  check('竖屏：相机只横向跟随（人走动后镜头也跟）', portCamX.sx > 3, `camScrollX=${portCamX.sx}`);
  const filePort = await shot(client, '04-portrait-390x844');
  console.log('截图:', filePort);

  /* 10. 无脚本错误 */
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
