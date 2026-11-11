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

window.TOUCH = window.TOUCH || { left: false, right: false, jump: false, down: false };

/* ------------------------------- 标题场景 ------------------------------- */
class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  init(data) { this.result = data || {}; this.started = false; }

  create() {
    this.cameras.main.setBackgroundColor(C.sky);
    this.input.enabled = true;

    this.add.text(VIEW.W / 2, 132, '平台跳跃 · 像素远征', {
      ...FONT, fontSize: '44px', color: '#e9f0ff', fontStyle: 'bold'
    }).setOrigin(0.5);

    this.add.text(VIEW.W / 2, 188, '三段关卡 · 金币 · 尖刺 · 巡逻敌人', {
      ...FONT, fontSize: '18px', color: '#9fb0d0'
    }).setOrigin(0.5);

    if (this.result.win) {
      this.add.text(VIEW.W / 2, 244, `通关！金币 ${this.result.coins || 0} · 阵亡 ${this.result.deaths || 0} 次`, {
        ...FONT, fontSize: '22px', color: '#8ce99a'
      }).setOrigin(0.5);
    }

    this.add.text(VIEW.W / 2, 318, '← → / A D 移动　　空格 / ↑ / W 跳跃　　长按跳更高', {
      ...FONT, fontSize: '17px', color: '#c7d3ea'
    }).setOrigin(0.5);
    this.add.text(VIEW.W / 2, 350, '↓ + 跳 穿过浅色单向平台　　碰尖刺或敌人回检查点　　R 重开', {
      ...FONT, fontSize: '15px', color: '#8b9ab8'
    }).setOrigin(0.5);

    const hint = this.add.text(VIEW.W / 2, 438, '按 空格 / 点击屏幕 开始', {
      ...FONT, fontSize: '20px', color: '#ffd54f'
    }).setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

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

  beginRunAt(idx) {
    if (this.started) return;
    this.started = true;
    this.registry.set('coins', 0);
    this.registry.set('deaths', 0);
    LEVELS.forEach((_, i) => this.registry.set('spawn_' + i, null));
    this.scene.stop('hud');
    this.scene.start('play', { level: idx });
  }

  beginRun() {
    if (this.started) return;
    this.started = true;
    this.registry.set('coins', 0);
    this.registry.set('deaths', 0);
    LEVELS.forEach((_, i) => this.registry.set('spawn_' + i, null));
    this.scene.stop('hud');
    this.scene.start('play', { level: 0 });
  }
}


/* -------------------------------- HUD 场景 ------------------------------- */
class HudScene extends Phaser.Scene {
  constructor() { super('hud'); }

  create() {
    const style = { ...FONT, fontSize: '16px', color: '#e9f0ff' };
    this.levelText = this.add.text(18, 14, '', style);
    this.coinText = this.add.text(VIEW.W - 18, 14, '', style).setOrigin(1, 0);
    this.deathText = this.add.text(VIEW.W - 18, 38, '', { ...FONT, fontSize: '13px', color: '#8b9ab8' }).setOrigin(1, 0);

    const paint = () => {
      this.levelText.setText(this.registry.get('levelName') || '');
      this.coinText.setText('金币 ' + (this.registry.get('coins') || 0));
      this.deathText.setText('阵亡 ' + (this.registry.get('deaths') || 0));
    };
    paint();

    this.registry.events.on('changedata-coins', paint);
    this.registry.events.on('changedata-deaths', paint);
    this.registry.events.on('changedata-levelName', paint);
    this.events.once('shutdown', () => {
      this.registry.events.off('changedata-coins', paint);
      this.registry.events.off('changedata-deaths', paint);
      this.registry.events.off('changedata-levelName', paint);
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
  }

  create() {
    const L = LEVELS[this.levelIndex];
    this.level = L;
    this.registry.set('levelName', L.name);

    this.solids = [];
    this.oneWay = [];
    this.coins = [];
    this.foes = [];
    this.hazards = [];

    /* 物理世界底部要比屏幕低，玩家才能真的掉进坑里被判定死亡；
       相机边界仍只到 VIEW.H，画面不会跟着掉下去 */
    this.physics.world.setBounds(0, 0, L.width, VIEW.H + 400);
    this.cameras.main.setBounds(0, 0, L.width, VIEW.H);
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

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(150, 100);

    if (!this.scene.isActive('hud')) this.scene.launch('hud');
    this.scene.bringToTop('hud');

    this.showLevelIntro();
  }

  /* ------------------------------ 场景搭建 ------------------------------ */

  buildBackdrop(L) {
    /* 远景两层山丘：圆心压在地平线以下，只露出山尖，慢视差 */
    for (let layer = 0; layer < 2; layer++) {
      const step = layer === 0 ? 150 : 110;
      const rBase = layer === 0 ? 96 : 66;
      const baseY = layer === 0 ? 566 : 600;
      const color = layer === 0 ? C.hillFar : C.hillNear;
      const alpha = layer === 0 ? 0.30 : 0.46;
      const par = layer === 0 ? 0.22 : 0.42;
      for (let x = -120; x < L.width + 200; x += step) {
        const i = Math.round(x / step);
        const r = rBase + ((i * 23) % 44);
        this.add.circle(x, baseY - ((i * 17) % 34), r, color, alpha).setScrollFactor(par, par);
      }
    }
    /* 星点，最慢视差 */
    for (let i = 0; i < 46; i++) {
      const x = (i * 97) % L.width;
      const y = 44 + ((i * 53) % 300);
      this.add.circle(x, y, 1.6, 0x9fb0d0, 0.45).setScrollFactor(0.1, 0.1);
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
    const intro = this.add.text(VIEW.W / 2, 116, this.level.name, {
      ...FONT, fontSize: '26px', color: '#ffd54f'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(50);
    const tip = this.add.text(VIEW.W / 2, 150, '到达绿旗进入下一关', {
      ...FONT, fontSize: '15px', color: '#9fb0d0'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(50);
    this.tweens.add({
      targets: [intro, tip], alpha: 0, delay: 1600, duration: 700,
      onComplete: () => { intro.destroy(); tip.destroy(); }
    });
  }

  /* -------------------------------- 主循环 -------------------------------- */

  update(time, delta) {
    if (!this.player || !this.player.body) return;
    const dt = Math.min(delta, 40) / 1000;
    const body = this.player.body;

    if (this.keys.r.isDown && !this.isDead && !this.completed) {
      this.registry.set('coins', 0);
      this.registry.set('deaths', 0);
      LEVELS.forEach((_, i) => this.registry.set('spawn_' + i, null));
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
    this.isDead = true;
    this.registry.set('deaths', (this.registry.get('deaths') || 0) + 1);
    this.cameras.main.shake(160, 0.012);
    this.cameras.main.flash(140, 220, 60, 60);
    this.player.setFillStyle(0xff5252, 1);
    this.physics.pause();
    this.time.delayedCall(620, () => {
      this.physics.resume();
      this.scene.restart({ level: this.levelIndex });
    });
  }

  reachGoal() {
    if (this.isDead || this.completed) return;
    this.completed = true;
    this.physics.pause();
    const last = this.levelIndex >= LEVELS.length - 1;
    const msg = last ? '通关！' : '过关 · ' + this.level.name;
    const txt = this.add.text(VIEW.W / 2, 196, msg, {
      ...FONT, fontSize: '38px', color: '#8ce99a', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(60);
    this.tweens.add({ targets: txt, scaleX: 1.12, scaleY: 1.12, duration: 420, yoyo: true });
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
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: [TitleScene, PlayScene, HudScene]
};

window.addEventListener('load', () => {
  window.GAME = new Phaser.Game(GAME_CONFIG);
});
