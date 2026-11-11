# 平台跳跃 · 像素远征（Pixel Expedition Platformer）

一个用 **Phaser 4.2 + Arcade Physics** 写的 2D 平台跳跃游戏，纯静态文件，可直接挂在任何静态托管上（GitHub Pages / Cloudflare Pages / 任意 CDN）。

玩法：跑、跳、踩单向平台、躲尖刺和巡逻敌人、吃金币、用检查点存档，冲到绿旗进下一关。共三关。

## 在线试玩

> 部署后把地址写在这里：`https://mndgdd.github.io/platformer/`

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
src/levels.js           手感参数 FEEL、三关全部几何与道具坐标
src/scenes.js           TitleScene / PlayScene / HudScene、控制器、GAME_CONFIG
vendor/phaser.min.js    Phaser 4.2.0（本地化，不依赖 CDN）
tools/selftest.mjs      CDP 冒烟测试：真按键驱动，验证 15 项核心行为
```

## 本地运行

直接双击 `index.html` 即可（全部用 classic script，file:// 下也能跑）。
想用 http 起服务：`python -m http.server 8000`，然后访问 `http://localhost:8000/`。

调试直达关卡：`index.html?play=1` / `?play=2` / `?play=3`（跳过标题直接进对应关卡）。

## 自测

```
node tools/selftest.mjs
```

用 Chrome DevTools Protocol 发真实按键事件，覆盖：场景启动、右移加速、速度上限、刹车、长按跳、点按切高度、吃金币、掉坑死亡、死亡回起点、检查点写入、检查点重生、进下一关、无运行时错误。当前 15/15 通过。

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

## 已知取舍

- 美术是最小化几何图形（矩形/圆/三角），没有贴图资源，刻意保持零依赖。
- 音效未做（`audio-design` 技能里给了总线/ducking 做法，需要音频素材才有意义）。
- 墙跳（wall jump）未实现；`platformer` 技能的 `references/feel-tuning.md` §9 有完整解算器，可作为下一步扩展。
