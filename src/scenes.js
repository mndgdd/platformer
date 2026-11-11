/* ==========================================================================
   场景实现：标题 / 关卡 / HUD
   引擎：Phaser 4.2（Arcade Physics）
   手感来自 platformer 技能：coyote time、jump buffer、可变跳跃高度、
   下落重力 > 上升重力、顶端滞空、单向平台、持久检查点。
   ========================================================================== */

const C = {
  sky: 0x0f1424,
  hillFar: 0x1b2440,
  hillNear: 0x222e52,
  ground: 0x2f3b58,
  groundTop: 0x3d4c70,
  plat: 0x3f7f8f,
  block: 0x556180,
  spike: 0xe05a5a,
  coin: 0xffd54f,
  player: 0x4fc3f7,
  playerEye: 0x0b1220,
  foe: 0xff8a65,
  flag: 0x8ce99a,
  empty: 0x000000
};

const FONT = { fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif' };

/* 竖屏时画布只有 960×540 被压成 ~390×219（0.41 倍），字会小到看不清，
   所以界面文字按比例放大，让屏幕上的实际字号回到可读区间。 */
const PORTRAIT_UI_SCALE = 1.9;
function uiK() {
  try {
    return (window.__UI__ && window.__UI__.isPortrait && window.__UI__.isPortrait()) ? PORTRAIT_UI_SCALE : 1;
  } catch (e) { return 1; }
}

window.TOUCH = window.TOUCH || { left: false, right: false, jump: false, down: false };

/* 激励视频复活配置。接真实广告联盟时：把 provider 改成 'custom'，
   并提供 window.AD_PROVIDER = { showRewarded() => Promise<boolean> }。 */
window.AD_CONFIG = window.AD_CONFIG || {
  provider: 'demo',          // demo = 演示广告；custom = 由页面注入的 AD_PROVIDER 接管
  rewardSeconds: 15,         // 演示广告时长（秒）
  skipAfter: 5,              // 多少秒后可跳过
  maxRevivesPerLevel: 2      // 每关最多几次广告复活
};

/* 页面 UI 与场景之间的桥（复活面板、广告遮罩都由 DOM 画，逻辑在场景里） */
window.GAME_EVENTS = window.GAME_EVENTS || new Phaser.Events.EventEmitter();

/* ------------------------------- 标题场景 ------------------------------- */
class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  init(data) { this.result = data || {}; this.started = false; }

  create() {
    this.cameras.main.setBackgroundColor(C.sky);
    this.input.enabled = true;
    this.texts = [];
    this.layout();

    this.onResizeEvt = () => this.layout();
    this.scale.on('resize', this.onResizeEvt);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResizeEvt));

    this.input.keyboard.on('keydown-SPACE', () => this.beginRun());
    this.input.keyboard.on('keydown-ENTER', () => this.beginRun());
    this.input.on('pointerdown', () => this.beginRun());

    /* 直入关卡（自动化冒烟测试 / 分享时跳过标题）：?play=1 / ?play=2 */
    const auto = new URLSearchParams(window.location.search).get('play');
    if (auto !== null) {
      const idx = Math.max(0, Math.min(LEVELS.length - 1, (parseInt(auto, 10) || 1) - 1));
      this.beginRunAt(idx);
    }
  }

  /* 标题页按画布真实尺寸排版：横屏沿用 960×540 设计稿（整体等比缩放），
     竖屏换成纵向排布，字号直接按屏幕像素给，不再靠放大系数硬撑。 */
  layout() {
    (this.texts || []).forEach((t) => t.destroy());
    this.texts = [];
    if (this.hintTween) { this.hintTween.stop(); this.hintTween = null; }

    const w = this.scale.width, h = this.scale.height;
    const portrait = h > w * 1.05;
    const push = (x, y, text, size, color, bold) => {
      const t = this.add.text(x, y, text, {
        ...FONT, fontSize: Math.round(size) + 'px', color, fontStyle: bold ? 'bold' : 'normal'
      }).setOrigin(0.5);
      this.texts.push(t);
      return t;
    };

    if (portrait) {
      const cx = w / 2;
      push(cx, h * 0.20, '平台跳跃 · 像素远征', Math.min(w * 0.082, 40), '#e9f0ff', true);
      push(cx, h * 0.20 + Math.min(w * 0.075, 34), LEVELS.length + ' 关 · 广告复活', w * 0.042, '#9fb0d0');
      if (this.result.win) {
        push(cx, h * 0.20 + Math.min(w * 0.075, 34) * 2,
          `通关！金币 ${this.result.coins || 0} · 阵亡 ${this.result.deaths || 0} 次`, w * 0.048, '#8ce99a');
      }
      push(cx, h * 0.52, '← → / A D 移动', w * 0.045, '#c7d3ea');
      push(cx, h * 0.52 + w * 0.07, '空格 / ↑ / W 跳跃（长按更高）', w * 0.045, '#c7d3ea');
      push(cx, h * 0.52 + w * 0.14, '↓ + 跳 穿单向平台　R 重开', w * 0.040, '#8b9ab8');
      const hint = push(cx, h * 0.80, '点击屏幕 开始', w * 0.052, '#ffd54f', true);
      this.hintTween = this.tweens.add({ targets: hint, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
    } else {
      const fy = h / 540;
      const cx = w / 2;
      push(cx, 132 * fy, '平台跳跃 · 像素远征', 44 * fy, '#e9f0ff', true);
      push(cx, 188 * fy, LEVELS.length + ' 关 · 金币 · 尖刺 · 巡逻敌人 · 广告复活', 18 * fy, '#9fb0d0');
      if (this.result.win) {
        push(cx, 244 * fy, `通关！金币 ${this.result.coins || 0} · 阵亡 ${this.result.deaths || 0} 次`, 22 * fy, '#8ce99a');
      }
      push(cx, 318 * fy, '← → / A D 移动　　空格 / ↑ / W 跳跃　　长按跳更高', 17 * fy, '#c7d3ea');
      push(cx, 350 * fy, '↓ + 跳 穿过浅色单向平台　　碰尖刺或敌人回检查点　　R 重开', 15 * fy, '#8b9ab8');
      const hint = push(cx, 438 * fy, '按 空格 / 点击屏幕 开始', 20 * fy, '#ffd54f');
      this.hintTween = this.tweens.add({ targets: hint, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
    }
  }

  beginRunAt(idx) {
    if (this.started) return;
    this.started = true;
    this.registry.set('coins', 0);
    this.registry.set('deaths', 0);
    LEVELS.forEach((_, i) => {
      this.registry.set('spawn_' + i, null);
      this.registry.set('revives_' + i, 0);
    });
    this.scene.stop('hud');
    this.scene.start('play', { level: idx });
  }

  beginRun() {
    if (this.started) return;
    this.started = true;
    this.registry.set('coins', 0);
    this.registry.set('deaths', 0);
    LEVELS.forEach((_, i) => {
      this.registry.set('spawn_' + i, null);
      this.registry.set('revives_' + i, 0);
    });
    this.scene.stop('hud');
    this.scene.start('play', { level: 0 });
  }
}


/* -------------------------------- HUD 场景 ------------------------------- */
class HudScene extends Phaser.Scene {
  constructor() { super('hud'); }

  create() {
    this.levelText = this.add.text(0, 0, '', { ...FONT, fontSize: '16px', color: '#e9f0ff' });
    this.coinText = this.add.text(0, 0, '', { ...FONT, fontSize: '16px', color: '#e9f0ff' }).setOrigin(1, 0);
    this.deathText = this.add.text(0, 0, '', { ...FONT, fontSize: '13px', color: '#8b9ab8' }).setOrigin(1, 0);
    this.reviveText = this.add.text(0, 0, '', { ...FONT, fontSize: '13px', color: '#ffd54f' }).setOrigin(1, 0);
    this.banner = this.add.text(0, 0, '', { ...FONT, fontSize: '26px', color: '#ffd54f' }).setOrigin(0.5).setAlpha(0).setDepth(50);
    this.bannerSub = this.add.text(0, 0, '', { ...FONT, fontSize: '15px', color: '#9fb0d0' }).setOrigin(0.5).setAlpha(0).setDepth(50);

    this.layout();
    this.onResizeEvt = () => this.layout();
    this.scale.on('resize', this.onResizeEvt);

    const paint = () => {
      this.levelText.setText(this.registry.get('levelName') || '');
      this.coinText.setText('金币 ' + (this.registry.get('coins') || 0));
      this.deathText.setText('阵亡 ' + (this.registry.get('deaths') || 0));
      const left = this.registry.get('revivesLeft');
      this.reviveText.setText(left === undefined ? '' : '广告复活 ' + left + ' 次');
    };
    paint();
    if (this.pendingBanner) {
      const p = this.pendingBanner;
      this.pendingBanner = null;
      this.showBanner(p[0], p[1], p[2]);
    }

    this.registry.events.on('changedata-coins', paint);
    this.registry.events.on('changedata-deaths', paint);
    this.registry.events.on('changedata-levelName', paint);
    this.registry.events.on('changedata-revivesLeft', paint);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResizeEvt);
      this.registry.events.off('changedata-coins', paint);
      this.registry.events.off('changedata-deaths', paint);
      this.registry.events.off('changedata-levelName', paint);
      this.registry.events.off('changedata-revivesLeft', paint);
    });
  }

  /* HUD 直接用画布像素排版（HUD 相机 zoom=1），横屏字号按 540 高折算，
     竖屏给更大的字号，避免小屏上读不清 */
  layout() {
    const w = this.scale.width, h = this.scale.height;
    const portrait = h > w * 1.05;
    const base = portrait ? Math.max(15, Math.round(w * 0.042)) : Math.round(16 * h / 540);
    const sub = portrait ? Math.max(12, Math.round(w * 0.033)) : Math.round(13 * h / 540);
    const mx = portrait ? 12 : Math.round(18 * h / 540);
    const y1 = portrait ? 12 : Math.round(14 * h / 540);
    /* 竖屏右上角有 DOM 的"横屏更爽"胶囊，右侧统计往下让一行 */
    const ry1 = portrait ? 46 : y1;
    const y2 = ry1 + Math.round(base * 1.55);
    const y3 = y2 + Math.round(sub * 1.7);

    this.levelText.setFontSize(base).setPosition(mx, y1);
    this.coinText.setFontSize(base).setPosition(w - mx, ry1);
    this.deathText.setFontSize(sub).setPosition(w - mx, y2);
    this.reviveText.setFontSize(sub).setPosition(w - mx, y3);

    const bx = w / 2, by = h * 0.26;
    this.banner.setFontSize(portrait ? Math.max(18, Math.round(w * 0.058)) : Math.round(26 * h / 540))
      .setPosition(bx, by);
    this.bannerSub.setFontSize(portrait ? Math.max(13, Math.round(w * 0.038)) : Math.round(15 * h / 540))
      .setPosition(bx, by + (portrait ? Math.round(w * 0.075) : Math.round(30 * h / 540)));
  }

  /* 关卡开场提示 / 过关横幅：放在 HUD 相机里，不受关卡镜头缩放影响 */
  showBanner(main, sub, ms) {
    if (!this.banner) { this.pendingBanner = [main, sub, ms]; return; }
    this.banner.setText(main || '');
    this.bannerSub.setText(sub || '');
    this.banner.setAlpha(1);
    this.bannerSub.setAlpha(1);
    if (this.bannerTween) { this.bannerTween.stop(); this.bannerTween = null; }
    this.tweens.add({
      targets: [this.banner, this.bannerSub],
      alpha: 0, delay: Math.max(600, (ms || 1600) - 700), duration: 700,
      onComplete: () => { this.banner.setText(''); this.bannerSub.setText(''); }
    });
  }
}

/* -------------------------------- 关卡场景 -------------------------------- */
class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  init(data) {
    this.levelIndex = (data && data.level) || 0;
    this.isDead = false;
    this.completed = false;
    this.checkpointDone = false;
    this.coyoteTimer = 0;
    this.bufferTimer = 0;
    this.dropTimer = 0;
    this.wasOnFloor = false;
    this.prevJump = false;
    this.facing = 1;
    this.invincibleUntil = 0;
    this.deathPos = null;
  }

  create() {
    const L = LEVELS[this.levelIndex];
    this.level = L;
    this.registry.set('levelName', L.name + '   ' + (this.levelIndex + 1) + '/' + LEVELS.length);
    this.registry.set('revivesLeft', this.revivesLeft());

    this.solids = [];
    this.oneWay = [];
    this.coins = [];
    this.foes = [];
    this.hazards = [];

    /* 物理世界底部要比屏幕低，玩家才能真的掉进坑里被判定死亡；
       相机的缩放与上下边界由 applyView() 按横/竖屏分别设置 */
    this.physics.world.setBounds(0, 0, L.width, VIEW.H + 400);
    this.cameras.main.setBackgroundColor(C.sky);

    this.buildBackdrop(L);
    this.buildGeometry(L);
    this.buildProps(L);
    this.buildPlayer(L);
    this.buildInput();

    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.player, this.oneWay, null, () => this.dropTimer <= 0);
    this.physics.add.overlap(this.player, this.coins, (p, coin) => this.collectCoin(coin));
    this.physics.add.overlap(this.player, this.hazards, () => this.die());
    this.physics.add.overlap(this.player, this.foes, () => this.die());
    if (this.goalZone) this.physics.add.overlap(this.player, this.goalZone, () => this.reachGoal());
    if (this.checkpointZone) this.physics.add.overlap(this.player, this.checkpointZone, () => this.activateCheckpoint());

    this.applyView();
    this.onResizeEvt = () => this.applyView();
    this.scale.on('resize', this.onResizeEvt);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResizeEvt));

    if (!this.scene.isActive('hud')) this.scene.launch('hud');
    this.scene.bringToTop('hud');

    /* 复活面板 / 广告走 DOM，这里只接收结果 */
    this.onReviveEvt = () => this.doRevive();
    this.onRespawnEvt = () => this.respawnNow();
    window.GAME_EVENTS.on('player:revive', this.onReviveEvt);
    window.GAME_EVENTS.on('player:respawn', this.onRespawnEvt);
    this.events.once('shutdown', () => {
      window.GAME_EVENTS.off('player:revive', this.onReviveEvt);
      window.GAME_EVENTS.off('player:respawn', this.onRespawnEvt);
      window.GAME_EVENTS.emit('ui:close');
    });

    this.showLevelIntro();
  }

  /* ------------------------------ 场景搭建 ------------------------------ */

  /* 相机视野：横屏=高度铺满（可见世界更宽，两侧补天空/远景）；
     竖屏=只露一段更窄的世界宽度、放大到 1:1 左右，多出来的竖向高度全给天空，
     地面压到屏幕底部，这就是"竖屏专用相机视野" */
  applyView() {
    const cam = this.cameras.main;
    const w = this.scale.width, h = this.scale.height;
    const portrait = h > w * 1.05;
    const L = this.level;

    if (portrait) {
      /* 竖屏可见世界宽度：420~560 之间，屏幕越宽给得越多 */
      const visibleW = Math.max(420, Math.min(560, Math.round(w * 1.3)));
      const z = w / visibleW;
      const visibleH = h / z;
      const sky = Math.max(0, visibleH - VIEW.H);
      cam.setZoom(z);
      /* 竖屏不用 Phaser 的边界夹取（它按视口高度算，会把镜头又拉回地面中线），
         边界自己管：横向在 update 里 clamp，纵向钉死在地面底部 */
      cam.useBounds = false;
      /* Phaser 相机的 midPoint = scrollY + 视口高/2（不除 zoom），
         要让世界 y=540 正好落在屏幕底边，就得反推出这个 scrollY */
      const lockedY = (VIEW.H - h / (2 * z)) - h / 2;
      cam.setScroll(0, lockedY);
      /* 竖向没有可跟随的余量：停掉自动跟随，改成自己只跟 X、Y 钉在地面 */
      cam.stopFollow();
      cam.setDeadzone(0, 0);
      this.manualFollow = true;
      this.viewW = visibleW;
      this.viewH = visibleH;
      this.lockedScrollY = lockedY;
    } else {
      const z = h / VIEW.H;
      cam.setZoom(z);
      cam.setBounds(0, 0, L.width, VIEW.H);
      cam.setDeadzone(150, 100);
      this.manualFollow = false;
      this.viewW = 0;
      this.lockedScrollY = null;
      cam.useBounds = true;
      if (this.player) cam.startFollow(this.player, true, 0.12, 0.12);
    }
  }

  buildBackdrop(L) {
    /* 竖屏相机能看到地面以上的大块天空：先用分层色带铺出"更高的天空"，
       再补星点、月亮和远景云，保证加高后上方不是一块空白 */
    const portrait = this.scale.height > this.scale.width * 1.05;
    const SKY_TOP = -1500;
    const bands = 60;
    const SKY_BOTTOM = VIEW.H;                       /* 渐变一直铺到地平线（地面顶） */
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);                    /* 0=天顶（最暗） 1=地平线（略亮） */
      const c0 = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x05070f),
        Phaser.Display.Color.ValueToColor(0x24325a),
        100, Math.round(t * 100)
      );
      const col = Phaser.Display.Color.GetColor(c0.r, c0.g, c0.b);
      const y0 = SKY_TOP + (SKY_BOTTOM - SKY_TOP) * (i / bands);
      const y1 = SKY_TOP + (SKY_BOTTOM - SKY_TOP) * ((i + 1) / bands);
      this.add.rectangle(L.width / 2, (y0 + y1) / 2, L.width + 400, (y1 - y0) + 1, col)
        .setScrollFactor(1, 1).setDepth(-20);
    }

    /* 月亮 + 光晕：只对竖屏有意义（横屏看不到世界 0 线以上），放很慢的横向视差 */
    this.add.circle(240, -300, 100, 0x93a9d6, 0.06).setScrollFactor(0.05, 1).setDepth(-12);
    this.add.circle(240, -300, 56, 0xbccbe6, 0.10).setScrollFactor(0.05, 1).setDepth(-12);
    this.add.circle(240, -300, 30, 0xf2f7ff, 0.62).setScrollFactor(0.05, 1).setDepth(-12);

    /* 远景云：很淡的水平椭圆，慢视差，只在天空区域 */
    for (let i = 0; i < 16; i++) {
      const x = ((i * 211) % Math.max(1, L.width)) + ((i % 3) * 60);
      const y = -120 - ((i * 97) % 1100);
      const w = 120 + ((i * 37) % 160);
      this.add.ellipse(x, y, w, 26 + ((i * 11) % 18), 0x3c4a6d, 0.10 + ((i % 3) * 0.03))
        .setScrollFactor(0.16, 1).setDepth(-10);
    }

    /* 远景两层山丘：圆心压在地平线以下，只露出山尖，慢视差 */
    const hillK = portrait ? 0.78 : 1;
    for (let layer = 0; layer < 2; layer++) {
      const step = layer === 0 ? 150 : 110;
      const rBase = layer === 0 ? 96 : 66;
      const baseY = layer === 0 ? 566 : 600;
      const color = layer === 0 ? C.hillFar : C.hillNear;
      const alpha = layer === 0 ? 0.38 : 0.52;
      const par = layer === 0 ? 0.22 : 0.42;
      for (let x = -120; x < L.width + 200; x += step) {
        const i = Math.round(x / step);
        const r = (rBase + ((i * 23) % 44)) * hillK;
        this.add.circle(x, baseY - ((i * 17) % 34) * hillK, r, color, alpha)
          .setScrollFactor(par, 1).setDepth(layer === 0 ? -18 : -16);
      }
    }
    /* 星点：从地面一直铺到加高后的天空顶部，竖向不做视差，位置可预期 */
    for (let i = 0; i < 260; i++) {
      const x = (i * 97) % L.width;
      const y = 44 + ((i * 53) % 300) - ((i % 9) * 170);
      const a = 0.30 + ((i % 4) * 0.16);
      this.add.circle(x, y, 1.2 + (i % 3) * 0.6, 0xa9bada, a).setScrollFactor(0.1, 1).setDepth(-14);
    }
  }

  buildGeometry(L) {
    (L.ground || []).forEach((seg) => {
      const x1 = seg[0];
      const x2 = seg[1];
      const w = x2 - x1;
      const body = this.add.rectangle(x1 + w / 2, GROUND_TOP + 22, w, 44, C.ground);
      this.add.rectangle(x1 + w / 2, GROUND_TOP + 4, w, 8, C.groundTop);
      this.physics.add.existing(body, true);
      this.solids.push(body);
    });

    (L.plat || []).forEach((p) => {
      const rect = this.add.rectangle(p.x + p.w / 2, p.y + 6, p.w, 12, C.plat);
      this.physics.add.existing(rect, true);
      const b = rect.body;
      b.checkCollision.down = false;
      b.checkCollision.left = false;
      b.checkCollision.right = false;
      this.oneWay.push(rect);
    });

    (L.block || []).forEach((p) => {
      const rect = this.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, C.block);
      this.physics.add.existing(rect, true);
      this.solids.push(rect);
    });

    (L.spikes || []).forEach((s) => {
      const n = Math.max(1, Math.round(s.w / 16));
      for (let i = 0; i < n; i++) {
        const cx = s.x + 8 + i * 16;
        this.add.triangle(cx, s.y - 9, 0, 0, 16, 0, 8, 18, C.spike);
      }
      const zone = this.add.rectangle(s.x + s.w / 2, s.y - 7, s.w, 14, C.empty, 0);
      this.physics.add.existing(zone, true);
      this.hazards.push(zone);
    });
  }

  buildProps(L) {
    (L.coins || []).forEach((c) => {
      this.add.circle(c.x, c.y, 15, C.coin, 0.16);
      const coin = this.add.circle(c.x, c.y, 8, C.coin);
      this.physics.add.existing(coin, true);
      this.coins.push(coin);
      this.tweens.add({ targets: coin, scaleY: 0.6, duration: 620, yoyo: true, repeat: -1 });
    });

    (L.foes || []).forEach((f) => {
      const foe = this.add.rectangle(f.x, f.y, 28, 24, C.foe);
      foe.eyes = [
        this.add.rectangle(f.x - 5, f.y - 3, 4, 4, C.playerEye),
        this.add.rectangle(f.x + 5, f.y - 3, 4, 4, C.playerEye)
      ];
      this.physics.add.existing(foe, true);
      foe.patrol = f;
      foe.dir = 1;
      this.foes.push(foe);
    });

    if (L.checkpoint) {
      this.add.rectangle(L.checkpoint.x, L.checkpoint.y - 26, 4, 52, 0x6b7ba8);
      this.checkpointFlag = this.add.rectangle(L.checkpoint.x + 12, L.checkpoint.y - 44, 22, 14, 0x6b7ba8);
      this.checkpointZone = this.add.rectangle(L.checkpoint.x + 12, L.checkpoint.y - 28, 40, 60, C.empty, 0);
      this.physics.add.existing(this.checkpointZone, true);
      if (this.registry.get('spawn_' + this.levelIndex)) this.setCheckpointVisual(true);
    }

    if (L.goal) {
      this.add.rectangle(L.goal.x, L.goal.y - 40, 5, 80, 0xd7e3ff);
      const flag = this.add.triangle(L.goal.x + 20, L.goal.y - 58, 0, 0, 34, 12, 0, 24, C.flag);
      this.tweens.add({ targets: flag, scaleX: 1.06, duration: 900, yoyo: true, repeat: -1 });
      this.goalZone = this.add.rectangle(L.goal.x + 14, L.goal.y - 40, 44, 80, C.empty, 0);
      this.physics.add.existing(this.goalZone, true);
    }
  }

  buildPlayer(L) {
    const saved = this.registry.get('spawn_' + this.levelIndex);
    const spawn = saved || L.spawn;
    this.player = this.add.rectangle(spawn.x, spawn.y, 26, 36, C.player);
    this.player.setDepth(5);
    this.physics.add.existing(this.player);
    const body = this.player.body;
    body.setSize(26, 36);
    body.setCollideWorldBounds(true);
    body.setMaxVelocity(600, FEEL.maxFall);
    body.setGravityY(FEEL.fallGravity);
    this.eye = this.add.rectangle(spawn.x + 7, spawn.y - 4, 5, 5, C.playerEye).setDepth(6);
  }

  buildInput() {
    this.keys = this.input.keyboard.addKeys({
      left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN',
      a: 'A', d: 'D', w: 'W', s: 'S',
      space: 'SPACE', r: 'R'
    });
    this.touch = window.TOUCH;
  }

  showLevelIntro() {
    /* 开场提示交给 HUD 场景：它不受关卡镜头缩放影响，横竖屏都摆得正 */
    const hud = this.scene.get('hud');
    if (hud && hud.showBanner) hud.showBanner(this.level.name, '到达绿旗进入下一关', 1600);
  }

  /* -------------------------------- 主循环 -------------------------------- */

  update(time, delta) {
    if (!this.player || !this.player.body) return;
    /* 竖屏镜头：只横向跟随（留出前方预判距离），纵向钉死让地面压在屏幕底部 */
    if (this.manualFollow) {
      const cam = this.cameras.main;
      const maxX = Math.max(0, this.level.width - this.viewW);
      const targetX = Math.max(0, Math.min(maxX, this.player.x - this.viewW * 0.42));
      cam.scrollX += (targetX - cam.scrollX) * 0.16;
      cam.scrollY = this.lockedScrollY;
    }
    const dt = Math.min(delta, 40) / 1000;
    const body = this.player.body;

    if (this.keys.r.isDown && !this.isDead && !this.completed) {
      this.registry.set('coins', 0);
      this.registry.set('deaths', 0);
      LEVELS.forEach((_, i) => {
        this.registry.set('spawn_' + i, null);
        this.registry.set('revives_' + i, 0);
      });
      this.scene.stop('hud');
      this.scene.start('title', { win: false });
      return;
    }

    if (this.isDead || this.completed) return;

    const onFloor = body.blocked.down || body.touching.down;
    const t = this.touch || {};

    const leftDown = this.keys.left.isDown || this.keys.a.isDown || t.left;
    const rightDown = this.keys.right.isDown || this.keys.d.isDown || t.right;
    const downDown = this.keys.down.isDown || this.keys.s.isDown || t.down;
    const jumpDown = this.keys.up.isDown || this.keys.space.isDown || this.keys.w.isDown || t.jump;

    const jumpPressed = jumpDown && !this.prevJump;
    const jumpReleased = !jumpDown && this.prevJump;
    this.prevJump = jumpDown;

    /* --- 水平：0.08 s 到全速，松手 0.06 s 刹停 --- */
    const dir = (rightDown ? 1 : 0) - (leftDown ? 1 : 0);
    const accel = FEEL.runSpeed / FEEL.accelTime;
    if (dir !== 0) {
      body.velocity.x = Phaser.Math.Clamp(body.velocity.x + dir * accel * dt, -FEEL.runSpeed, FEEL.runSpeed);
      this.facing = dir;
    } else {
      const stop = (FEEL.runSpeed / 0.06) * dt;
      body.velocity.x = Math.abs(body.velocity.x) <= stop ? 0 : body.velocity.x - Math.sign(body.velocity.x) * stop;
    }

    /* --- coyote + buffer --- */
    if (onFloor) this.coyoteTimer = FEEL.coyoteTime;
    else this.coyoteTimer -= dt;
    if (jumpPressed) this.bufferTimer = FEEL.jumpBuffer;
    this.bufferTimer -= dt;

    /* --- 单向平台下穿 --- */
    if (jumpPressed && downDown && onFloor && this.dropTimer <= 0) {
      this.dropTimer = FEEL.dropThroughTime;
      this.coyoteTimer = 0;
      this.bufferTimer = 0;
    }
    if (this.dropTimer > 0) this.dropTimer -= dt;

    /* --- 起跳（一次按键只消费一次） --- */
    if (this.bufferTimer > 0 && this.coyoteTimer > 0) {
      body.velocity.y = FEEL.jumpVelocity;
      this.bufferTimer = 0;
      this.coyoteTimer = 0;
      this.squash(0.86, 1.14);
    }

    /* --- 松手切高度：只切一次 --- */
    if (jumpReleased && body.velocity.y < 0) body.velocity.y *= FEEL.jumpCut;

    /* --- 非对称重力 + 顶端滞空 --- */
    let g = body.velocity.y < 0 ? FEEL.gravityRise : FEEL.fallGravity;
    if (!onFloor && Math.abs(body.velocity.y) < FEEL.apexThreshold) g *= 0.5;
    body.setGravityY(g);

    /* --- 落地反馈 --- */
    if (onFloor && !this.wasOnFloor) {
      this.squash(1.16, 0.84);
      this.landDust();
    }
    this.wasOnFloor = onFloor;

    /* --- 眼睛跟随与朝向 --- */
    this.eye.x = this.player.x + this.facing * 7;
    this.eye.y = this.player.y - 4;

    /* --- 敌人巡逻（一起移动眼睛，同步物理体） --- */
    this.foes.forEach((foe) => {
      const p = foe.patrol;
      foe.x += p.speed * foe.dir * dt;
      if (foe.x < p.from) { foe.x = p.from; foe.dir = 1; }
      if (foe.x > p.to) { foe.x = p.to; foe.dir = -1; }
      if (foe.body) foe.body.updateFromGameObject();
      if (foe.eyes) {
        foe.eyes[0].x = foe.x - 5; foe.eyes[0].y = foe.y - 3;
        foe.eyes[1].x = foe.x + 5; foe.eyes[1].y = foe.y - 3;
      }
    });

    /* --- 掉出世界 --- */
    if (this.player.y > VIEW.H + 60) this.die();
  }

  /* --------------------------------- 反馈 --------------------------------- */

  squash(sx, sy) {
    this.player.setScale(sx, sy);
    this.tweens.add({ targets: this.player, scaleX: 1, scaleY: 1, duration: 170, ease: 'Quad.easeOut' });
  }

  landDust() {
    for (let i = 0; i < 6; i++) {
      const d = this.add.circle(this.player.x + (i - 3) * 6, this.player.y + 18, 3, 0xa9b8d6, 0.8).setDepth(4);
      this.tweens.add({
        targets: d, x: d.x + (i - 3) * 12, y: d.y - 10, alpha: 0, duration: 380,
        onComplete: () => d.destroy()
      });
    }
  }

  collectCoin(coin) {
    if (!coin.active) return;
    const cx = coin.x;
    const cy = coin.y;
    coin.destroy();
    this.registry.set('coins', (this.registry.get('coins') || 0) + 1);
    const plus = this.add.text(cx, cy - 10, '+1', { ...FONT, fontSize: '14px', color: '#ffd54f' }).setOrigin(0.5);
    this.tweens.add({ targets: plus, y: plus.y - 24, alpha: 0, duration: 420, onComplete: () => plus.destroy() });
  }

  activateCheckpoint() {
    if (this.checkpointDone) return;
    this.checkpointDone = true;
    this.registry.set('spawn_' + this.levelIndex, {
      x: this.level.checkpoint.x,
      y: this.level.checkpoint.y - 40
    });
    this.setCheckpointVisual(true);
    this.cameras.main.flash(120, 80, 220, 140);
  }

  setCheckpointVisual(active) {
    if (this.checkpointFlag) this.checkpointFlag.setFillStyle(active ? C.flag : 0x6b7ba8, 1);
  }

  die() {
    if (this.isDead || this.completed) return;
    if (this.time.now < this.invincibleUntil) return;   // 广告复活后的无敌时间
    this.isDead = true;
    this.deathPos = { x: this.player.x, y: this.player.y };
    this.registry.set('deaths', (this.registry.get('deaths') || 0) + 1);
    this.cameras.main.shake(160, 0.012);
    this.cameras.main.flash(140, 220, 60, 60);
    this.player.setFillStyle(0xff5252, 1);
    this.physics.pause();

    const left = this.revivesLeft();
    if (left > 0) {
      /* 还有广告复活机会：交给 DOM 面板，用户选看广告或直接重来 */
      window.GAME_EVENTS.emit('player:dead', { revivesLeft: left, levelName: this.level.name });
    } else {
      this.time.delayedCall(620, () => this.respawnNow());
    }
  }

  revivesUsed() { return this.registry.get('revives_' + this.levelIndex) || 0; }

  revivesLeft() {
    const max = (window.AD_CONFIG && window.AD_CONFIG.maxRevivesPerLevel) || 0;
    return Math.max(0, max - this.revivesUsed());
  }

  /* 看完广告：回到检查点（没激活就用出生点）继续，金币与本关进度保留 */
  doRevive() {
    if (!this.isDead) return;
    const spawn = this.registry.get('spawn_' + this.levelIndex) || this.level.spawn;
    this.isDead = false;
    this.registry.set('revives_' + this.levelIndex, this.revivesUsed() + 1);
    this.registry.set('revivesLeft', this.revivesLeft());

    this.player.setFillStyle(C.player, 1);
    this.player.setAlpha(1);
    this.player.setPosition(spawn.x, spawn.y - 24);
    this.player.body.reset(spawn.x, spawn.y - 24);
    this.eye.setPosition(spawn.x + this.facing * 7, spawn.y - 28);

    this.wasOnFloor = false;
    this.coyoteTimer = 0;
    this.bufferTimer = 0;
    this.invincibleUntil = this.time.now + 2200;
    this.physics.resume();
    this.cameras.main.flash(160, 120, 255, 180);
    this.tweens.add({
      targets: this.player, alpha: 0.3, duration: 170, yoyo: true, repeat: 6,
      onComplete: () => this.player.setAlpha(1)
    });
    window.GAME_EVENTS.emit('ui:close');
  }

  respawnNow() {
    this.physics.resume();
    window.GAME_EVENTS.emit('ui:close');
    this.scene.restart({ level: this.levelIndex });
  }

  reachGoal() {
    if (this.isDead || this.completed) return;
    this.completed = true;
    this.physics.pause();
    const last = this.levelIndex >= LEVELS.length - 1;
    const msg = last ? '通关！' : '过关 · ' + this.level.name;
    const hud = this.scene.get('hud');
    if (hud && hud.showBanner) hud.showBanner(msg, '', 900);
    this.cameras.main.flash(180, 120, 255, 160);

    this.time.delayedCall(900, () => {
      this.physics.resume();
      if (last) {
        this.scene.stop('hud');
        this.scene.start('title', {
          win: true,
          coins: this.registry.get('coins') || 0,
          deaths: this.registry.get('deaths') || 0
        });
      } else {
        this.scene.restart({ level: this.levelIndex + 1 });
      }
    });
  }
}

/* --------------------------------- 入口 --------------------------------- */
const GAME_CONFIG = {
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.W,
  height: VIEW.H,
  backgroundColor: C.sky,
  scale: { mode: Phaser.Scale.RESIZE },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [TitleScene, PlayScene, HudScene]
};

window.addEventListener('load', () => {
  window.GAME = new Phaser.Game(GAME_CONFIG);
});
