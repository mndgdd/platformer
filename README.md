# 平台跳跃 · 像素远征（Pixel Expedition Platformer）

一个用 **Phaser 4.2 + Arcade Physics** 写的 2D 平台跳跃游戏，纯静态文件，可直接挂在任何静态托管上（GitHub Pages / Cloudflare Pages / 任意 CDN）。

玩法：跑、跳、踩单向平台、躲尖刺和巡逻敌人、吃金币、用检查点存档，冲到绿旗进下一关。**共 200 关**（前 3 关手作，第 4~200 关由确定性程序生成，同一关卡每次进入布局完全一致）。

## 在线试玩

**https://mndgdd.github.io/platformer/**

直达关卡：`?play=1` ~ `?play=200`（跳过标题直接进对应关卡，例如 `?play=120`）

## 操作

| 操作 | 按键 |
| --- | --- |
| 左右移动 | `←` `→` / `A` `D` |
| 跳跃（长按跳更高） | `空格` / `↑` / `W` |
| 穿过单向平台 | `↓` + 跳 |
| 重开 | `R` |

触屏设备会显示屏幕下方的虚拟按键（◀ ▶ ▼ 跳跃）。

## 手感参数怎么来的

不是拍脑袋填魔数，而是按 platformer 技能的做法**从手感反推物理**：先定期望高度与到顶时间，再算重力和初速。

```
跳跃高度  JUMP_HEIGHT  = 3.5 格 = 112 px
到顶时间  TIME_TO_APEX = 0.35 s
上升重力  g  = 2h / t²  = 1828.6
起跳初速  v0 = -2h / t  = -640
下落重力       = g × 1.8 = 3291.4   （下落更重，不飘）
```

其余手感参数（`src/levels.js` 的 `FEEL`）：

| 参数 | 值 | 作用 |
| --- | --- | --- |
| `coyoteTime` | 0.10 s | 刚离开边缘仍能起跳 |
| `jumpBuffer` | 0.12 s | 落地前按下也算数 |
| `jumpCut` | 0.45 | 松手把上升速度打折 → 点按=矮跳，长按=满跳 |
| `apexThreshold` | 60 px/s | 顶端重力减半，滞空好控 |
| `runSpeed` / `accelTime` | 320 px/s / 0.08 s | 0.08 秒到全速，手感跟手 |
| `dropThroughTime` | 0.18 s | 下+跳穿过单向平台的忽略窗口 |

实测（自动化测试）：长按跳峰值 105 px（设计 112 px，误差 <7%），点按跳峰值 75 px，跑速上限 320 px/s，松手 0.25 s 内速度归零。

## 目录结构

```
index.html              页面外壳 + 移动端虚拟按键 + 错误浮层
src/levels.js           手感参数 FEEL、200 关几何与道具（前 3 关手作 + buildLevel 程序生成）
src/scenes.js           TitleScene / PlayScene / HudScene、控制器、GAME_CONFIG
vendor/phaser.min.js    Phaser 4.2.0（本地化，不依赖 CDN）
tools/selftest.mjs      CDP 冒烟测试：真按键驱动，验证 37 项核心行为
tools/levelcheck.mjs     200 关几何静态校验（不启动浏览器，直接载 levels.js 逐关验算）
```

## 广告复活（变现位）

死亡时不再直接重开：面板给出「看广告复活」和「直接重来」。看完广告回到检查点（未激活检查点则回出生点），**金币、本关进度、已激活检查点全部保留**，并有 2.2 秒无敌闪烁。

参数在 `src/scenes.js` 顶部：

```js
window.AD_CONFIG = {
  provider: 'demo',          // demo = 演示广告；custom = 交由 AD_PROVIDER 接管
  rewardSeconds: 15,         // 演示广告时长
  skipAfter: 5,              // 多少秒后可跳过
  maxRevivesPerLevel: 2      // 每关最多几次复活（HUD 右上角显示剩余次数）
};
```

**接真实激励视频**：在 `index.html` 里定义 `window.AD_PROVIDER`，页面检测到就会优先走它，失败自动回退演示广告。

```js
window.AD_PROVIDER = {
  // 返回 true 表示完整观看，可以发奖励；false 表示没看完
  showRewarded() {
    return new Promise((resolve) => {
      // 例：AdSense 激励广告 / 第三方 H5 广告联盟 SDK 的展示回调里 resolve(true)
      myAdSdk.showRewardVideo({ adUnitId: 'xxx' }, (result) => resolve(result.isCompleted));
    });
  }
};
```

注意 AdMob 只支持原生 App（Android/iOS），**H5 网页用不了**；网页端要用 AdSense 激励广告或支持 H5 的广告联盟。

## 横竖屏自适应

- 画布用 `Phaser.Scale.RESIZE`，跟着 `#game`（100vw/100vh）走：实测横屏 844×390、竖屏 390×844，`display` 与 canvas CSS 尺寸都等于视口，整块屏铺满，不再出现「16:9 一条带子」。
- **两套相机视野**（`PlayScene.applyView()`）：
  - 横屏：`zoom = h/540`、边界锁 `(0,0,关卡宽,540)`、`startFollow` + `deadzone(150,100)`，按高度铺满世界。
  - 竖屏：可见世界宽 `clamp(round(w*1.3), 420, 560)`（390 宽屏约 507）、`zoom = w/可见宽`，可见高度多出 300px 以上（390×844 实测可见高 1097，天空多出 557px）。竖屏**关掉 Phaser 的边界夹取**（`useBounds = false`）、`stopFollow()`，改成 `manualFollow`：`update()` 里只横向跟随（`targetX = clamp(player.x - viewW*0.42, 0, 关卡宽-可见宽)`、插值 0.16），纵向每帧钉死 `lockedScrollY`，让世界 y=540 正好压在屏幕底边。
  - 注意 Phaser 相机的 `midPoint = scrollY + 视口高/2`（不除 zoom），所以竖屏纵向锁值要按 `540 - h/(2*zoom) - h/2` 反推（390×844 实测 -431），直接写 `-(可见高 - 540)` 会把地面顶到屏幕外。
- 背景按竖屏补高：天空渐变 60 段覆盖 y=-1500…540、月亮三环、16 朵云、两层山丘、260 个星点，云/山/星点的 **Y 轴 scrollFactor 一律 1**，否则慢视差会把远景挤到地平线外。
- HUD 与标题页改成用 `scale.width/height` 真实像素排版（`HudScene.layout()`、`TitleScene.layout()`），挂 `scale.on('resize')` 重算；竖屏下右侧统计下移一行（y=46）避开右上角胶囊。
- 右上角有个不挡操作的「⤢ 横屏更爽」小胶囊，点了才请求全屏并尝试 `screen.orientation.lock('landscape')`（浏览器不支持时仅全屏）。
- 窗口尺寸/旋转变化由 Scale Manager 自动重算：**不要**在 `updateRotate` 里手动 `game.scale.resize()`（会让 `displaySize` 滞后一拍），也**不要**额外调 `game.scale.refresh()`。

## 本地运行

直接双击 `index.html` 即可（全部用 classic script，file:// 下也能跑）。
想用 http 起服务：`python -m http.server 8000`，然后访问 `http://localhost:8000/`。

调试直达关卡：`index.html?play=N`（1~200，跳过标题直接进对应关卡）。

## 自测

```
node tools/selftest.mjs
```

用 Chrome DevTools Protocol 发真实按键事件，覆盖：场景启动、右移加速、速度上限、刹车、长按跳、点按切高度、吃金币、掉坑死亡、**广告复活面板弹出、广告播放与跳过、复活保留金币/消耗次数/无敌时间**、检查点写入、直接重来后从检查点重生、进下一关、**关卡总数 200 与第 4/50/100/150/199/200 关抽查**、**横屏画布铺满+相机 zoom=h/540、竖屏画布铺满+窄视野+天空多出 300px 以上+地面压屏底+只横向跟随**、无运行时错误。当前 **43/43 通过**（file:// 与线上地址各跑一遍）。

另有一层纯静态几何校验（不启动浏览器）：

```
node tools/levelcheck.mjs
```

它把 `src/levels.js` 载进 Node 的 `vm` 逐关验算：关卡总数 = 200、地面段连续不重叠且从 0 开始、坑宽 ≤ 185px（物理跳跃极限 ≈ 195px）、末段地面右边界 = width、出生点/检查点/终点都落在地面上、尖刺不压这三个点、敌人巡逻既不越坑也不覆盖这三个点、单向平台按「地面 → 平台 → 更高平台」的接力方式算抬升 ≤ 100px、金币不埋地。当前 **200 关 0 错误**。

## 关卡数据格式（`src/levels.js`）

```js
{
  name: '第一关 · 起步',
  width: 2800,
  spawn: { x, y },                        // 出生点
  ground: [[左, 右], ...],                // 实心地面段，顶部固定 GROUND_TOP
  plat:   [{ x, y, w }, ...],             // 单向平台（x=左边缘，y=顶面）
  block:  [{ x, y, w, h }, ...],          // 实心台块
  spikes: [{ x, y, w }, ...],             // 尖刺带
  coins:  [{ x, y }, ...],
  foes:   [{ x, y, from, to, speed }, ...],// 左右巡逻
  checkpoint: { x, y },
  goal:       { x, y }
}
```

改关卡只动这个文件，场景代码会自动按数据生成碰撞体与道具。

第 4 关起由 `buildLevel(no)` 生成：`levelRandom(no * 7919 + 13)` 线性同余伪随机，保证同一关每次进入的布局完全一致；难度系数 `d = (no - 4) / 196` 控制地面段数（3~6 段）、坑宽（80~145px）、尖刺/敌人/金币数量与敌人速度。改完务必跑一遍 `node tools/levelcheck.mjs`。

## 已知取舍

- 美术是最小化几何图形（矩形/圆/三角），没有贴图资源，刻意保持零依赖。
- 音效未做（`audio-design` 技能里给了总线/ducking 做法，需要音频素材才有意义）。
- 墙跳（wall jump）未实现；`platformer` 技能的 `references/feel-tuning.md` §9 有完整解算器，可作为下一步扩展。
