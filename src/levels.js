/* ==========================================================================
   平台跳跃 · 关卡与手感参数
   手感数值按 platformer 技能 Pattern 1 从"高度 + 到顶时间"反推，不是拍脑袋。
   坐标系：y 轴向下，地面顶部 y = GROUND_TOP。
   ========================================================================== */

const VIEW = { W: 960, H: 540 };
const GROUND_TOP = 496;
const TILE = 32;

/* 跳跃：3.5 格高、0.35 秒到顶
   gravity       = 2h / t²   → 上升重力
   jumpVelocity  = -2h / t    → 起跳初速
   fallGravity   = gravity * 1.8 → 下落更"重"，不飘
*/
const JUMP_HEIGHT = 3.5 * TILE;      // 112 px
const TIME_TO_APEX = 0.35;           // s
const FEEL = {
  gravityRise: (2 * JUMP_HEIGHT) / (TIME_TO_APEX * TIME_TO_APEX),   // ≈1828.6
  jumpVelocity: -(2 * JUMP_HEIGHT) / TIME_TO_APEX,                  // ≈ -640
  fallGravity: ((2 * JUMP_HEIGHT) / (TIME_TO_APEX * TIME_TO_APEX)) * 1.8,
  maxFall: 1400,
  runSpeed: 320,
  accelTime: 0.08,        // 0.08 s 到全速
  coyoteTime: 0.10,       // 离开边缘后仍可跳
  jumpBuffer: 0.12,       // 落地前按下也算
  jumpCut: 0.45,          // 松手切跳跃高度
  apexThreshold: 60,      // |vy| < 60 时重力减半，顶端微滞空
  dropThroughTime: 0.18   // 下 + 跳 穿过单向平台
};

/* 关卡结构
   ground : [左, 右] 实心地面段（顶部 GROUND_TOP）
   plat   : { x, y, w } 单向平台（x = 左边缘，y = 顶部）
   block  : { x, y, w, h } 实心台块（可站可撞墙）
   spikes : { x, y, w } 尖刺（y = 顶部）
   coins  : { x, y }
   foes   : { x, y, from, to, speed } 巡逻敌人
   checkpoint : { x, y }
   goal   : { x, y }
*/
const LEVELS = [
  {
    name: '第一关 · 起步',
    width: 2800,
    spawn: { x: 90, y: GROUND_TOP - 40 },
    ground: [[0, 760], [900, 1500], [1660, 2200], [2340, 2800]],
    plat: [
      { x: 600, y: 400, w: 96 },
      { x: 1000, y: 356, w: 112 },
      { x: 1300, y: 406, w: 120 },
      { x: 1760, y: 380, w: 96 },
      { x: 2020, y: 300, w: 96 }
    ],
    block: [],
    spikes: [{ x: 1150, y: GROUND_TOP, w: 64 }, { x: 1900, y: GROUND_TOP, w: 96 }],
    coins: [
      { x: 320, y: 448 }, { x: 400, y: 448 }, { x: 648, y: 368 },
      { x: 1056, y: 324 }, { x: 1360, y: 374 }, { x: 1808, y: 348 },
      { x: 2068, y: 268 }, { x: 2460, y: 448 }, { x: 2560, y: 448 }
    ],
    foes: [
      { x: 1000, y: GROUND_TOP - 14, from: 960, to: 1420, speed: 90 },
      { x: 2500, y: GROUND_TOP - 14, from: 2380, to: 2740, speed: 110 }
    ],
    checkpoint: { x: 1700, y: GROUND_TOP },
    goal: { x: 2720, y: GROUND_TOP }
  },
  {
    name: '第二关 · 往上爬',
    width: 3200,
    spawn: { x: 90, y: GROUND_TOP - 40 },
    ground: [[0, 620], [780, 1220], [1400, 1720], [1900, 2400], [2600, 3200]],
    plat: [
      { x: 660, y: 392, w: 88 },
      { x: 900, y: 320, w: 96 },
      { x: 1120, y: 384, w: 96 },
      { x: 1300, y: 300, w: 80 },
      { x: 1470, y: 372, w: 96 },
      { x: 1760, y: 296, w: 96 },
      { x: 2020, y: 372, w: 96 },
      { x: 2260, y: 288, w: 96 },
      { x: 2480, y: 360, w: 88 },
      { x: 2760, y: 300, w: 96 }
    ],
    block: [{ x: 2100, y: 430, w: 96, h: 66 }],
    spikes: [
      { x: 1000, y: GROUND_TOP, w: 96 },
      { x: 2150, y: GROUND_TOP, w: 128 },
      { x: 2860, y: GROUND_TOP, w: 96 }
    ],
    coins: [
      { x: 300, y: 448 }, { x: 700, y: 360 }, { x: 944, y: 288 },
      { x: 1356, y: 268 }, { x: 1512, y: 340 }, { x: 1808, y: 264 },
      { x: 2300, y: 256 }, { x: 2808, y: 268 }, { x: 3060, y: 448 }
    ],
    foes: [
      { x: 900, y: GROUND_TOP - 14, from: 820, to: 1180, speed: 110 },
      { x: 2300, y: GROUND_TOP - 14, from: 1960, to: 2360, speed: 120 },
      { x: 2700, y: GROUND_TOP - 14, from: 2650, to: 3050, speed: 100 }
    ],
    checkpoint: { x: 1980, y: GROUND_TOP },
    goal: { x: 3130, y: GROUND_TOP }
  },
  {
    name: '第三关 · 综合',
    width: 3600,
    spawn: { x: 90, y: GROUND_TOP - 40 },
    ground: [[0, 700], [880, 1340], [1520, 1900], [2100, 2560], [2760, 3600]],
    plat: [
      { x: 620, y: 396, w: 96 },
      { x: 1000, y: 360, w: 112 },
      { x: 1200, y: 288, w: 88 },
      { x: 1420, y: 380, w: 96 },
      { x: 1640, y: 296, w: 96 },
      { x: 1960, y: 360, w: 96 },
      { x: 2180, y: 300, w: 96 },
      { x: 2400, y: 384, w: 88 },
      { x: 2640, y: 300, w: 96 },
      { x: 2920, y: 372, w: 96 },
      { x: 3140, y: 288, w: 96 }
    ],
    block: [
      { x: 760, y: 420, w: 96, h: 76 },
      { x: 2520, y: 430, w: 96, h: 66 }
    ],
    spikes: [
      { x: 1100, y: GROUND_TOP, w: 128 },
      { x: 2260, y: GROUND_TOP, w: 160 },
      { x: 3000, y: GROUND_TOP, w: 128 }
    ],
    coins: [
      { x: 260, y: 448 }, { x: 664, y: 364 }, { x: 1060, y: 328 },
      { x: 1244, y: 256 }, { x: 1470, y: 348 }, { x: 1688, y: 264 },
      { x: 2224, y: 268 }, { x: 2444, y: 352 }, { x: 2688, y: 268 },
      { x: 3184, y: 256 }, { x: 3400, y: 448 }, { x: 3480, y: 448 }
    ],
    foes: [
      { x: 950, y: GROUND_TOP - 14, from: 900, to: 1300, speed: 120 },
      { x: 1700, y: GROUND_TOP - 14, from: 1560, to: 1860, speed: 130 },
      { x: 2200, y: GROUND_TOP - 14, from: 2160, to: 2520, speed: 140 },
      { x: 3300, y: GROUND_TOP - 14, from: 2800, to: 3560, speed: 110 }
    ],
    checkpoint: { x: 1560, y: GROUND_TOP },
    goal: { x: 3520, y: GROUND_TOP }
  }
];
