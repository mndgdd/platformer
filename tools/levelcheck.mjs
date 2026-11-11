/* 200 关几何校验：不启动浏览器，直接把 src/levels.js 载进 vm 逐关检查可通关性约束。
   约束来自 FEEL：跳跃高 112 px、水平滞空 ≈0.61 s × 320 px/s ≈ 195 px。
   用法：node tools/levelcheck.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = path.join(ROOT, '..', 'src', 'levels.js');
const code = fs.readFileSync(SRC, 'utf8');

const ctx = vm.createContext({ console });
vm.runInContext(
  code + '\n;globalThis.__OUT__ = { LEVELS, GROUND_TOP, VIEW, FEEL, TOTAL_LEVELS };',
  ctx,
  { filename: 'levels.js' }
);

const { LEVELS, GROUND_TOP, FEEL, TOTAL_LEVELS } = ctx.__OUT__;

const MAX_GAP = 185;        // 物理上限 ≈195 + coyote 余量，超过基本跳不过
const SAFE_GAP = 150;       // 建议安全线
const MAX_RISE = 100;       // 单次抬升上限（跳跃高 112）
const TOL = 1;

const errors = [];
const warnings = [];

const segOf = (ground, x) => ground.find(([a, b]) => x >= a - TOL && x <= b + TOL);
const near = (x, arr, pad) => arr.some((o) => Math.abs((o.x + (o.w || 0) / 2) - x) <= pad);

if (LEVELS.length !== TOTAL_LEVELS) {
  errors.push(`关卡总数 ${LEVELS.length} ≠ TOTAL_LEVELS ${TOTAL_LEVELS}`);
}
if (LEVELS.length !== 200) errors.push(`关卡总数应为 200，实际 ${LEVELS.length}`);

LEVELS.forEach((L, i) => {
  const tag = `[${i + 1}] ${L.name || '(无名)'}`;

  if (!L.name) errors.push(`${tag}: 缺少关卡名`);
  if (!(L.width > 0)) errors.push(`${tag}: width 非法`);

  /* 地面段：连续、非重叠、起点在 0 */
  if (L.ground[0][0] !== 0) errors.push(`${tag}: 首段地面未从 0 开始（${L.ground[0][0]}）`);
  for (let k = 0; k + 1 < L.ground.length; k++) {
    const gap = L.ground[k + 1][0] - L.ground[k][1];
    if (gap < 0) errors.push(`${tag}: 第 ${k + 1} 段地面与前一段重叠 ${-gap}px`);
    else if (gap > MAX_GAP) errors.push(`${tag}: 坑宽 ${gap}px 超过可跳越上限 ${MAX_GAP}px`);
    else if (gap > SAFE_GAP) warnings.push(`${tag}: 坑宽 ${gap}px 超过安全线 ${SAFE_GAP}px（仍可过）`);
  }
  if (L.ground[L.ground.length - 1][1] !== L.width) {
    errors.push(`${tag}: 末段地面右边界 ${L.ground[L.ground.length - 1][1]} ≠ width ${L.width}`);
  }

  /* 出生点 / 检查点 / 终点都必须落在地面上 */
  if (!segOf(L.ground, L.spawn.x)) errors.push(`${tag}: 出生点 x=${L.spawn.x} 不在任何地面段上`);
  if (L.spawn.y >= GROUND_TOP) errors.push(`${tag}: 出生点 y=${L.spawn.y} 低于地面顶部`);
  if (!segOf(L.ground, L.checkpoint.x)) errors.push(`${tag}: 检查点 x=${L.checkpoint.x} 不在地面上`);
  if (!segOf(L.ground, L.goal.x)) errors.push(`${tag}: 终点 x=${L.goal.x} 不在地面上`);
  if (L.goal.x <= L.spawn.x + 400) errors.push(`${tag}: 终点离出生点太近（${L.goal.x - L.spawn.x}px）`);

  /* 机关不能压在出生点/检查点/终点上 */
  for (const s of L.spikes) {
    if (s.w <= 0) errors.push(`${tag}: 尖刺宽度非法`);
    if (s.w > 160) warnings.push(`${tag}: 尖刺宽 ${s.w}px 偏宽，跨跳吃操作`);
    if (Math.abs(s.x + s.w / 2 - L.spawn.x) < 60) errors.push(`${tag}: 尖刺压住出生点`);
    if (Math.abs(s.x + s.w / 2 - L.checkpoint.x) < 80) errors.push(`${tag}: 尖刺压住检查点`);
    if (Math.abs(s.x + s.w / 2 - L.goal.x) < 100) errors.push(`${tag}: 尖刺压住终点`);
    const seg = segOf(L.ground, s.x);
    if (!seg || s.x + s.w > seg[1]) errors.push(`${tag}: 尖刺悬空或越出地面段`);
  }

  /* 单向平台 / 台块：手作前 3 关是人工排布（含装饰性平台），只做基础校验；
     第 4 关起是程序生成，逐层做"可达性"硬校验，保证真能跳上去。 */
  if (i >= 3) {
    for (const b of L.block) {
      if (!segOf(L.ground, b.x) || !segOf(L.ground, b.x + b.w)) errors.push(`${tag}: 台块不在同一地面段上`);
    }

    const supports = [];
    L.ground.forEach(([a, b]) => supports.push({ y: GROUND_TOP, from: a, to: b }));
    L.block.forEach((b) => supports.push({ y: b.y, from: b.x, to: b.x + b.w }));

    const pending = [...L.plat].sort((a, b) => b.y - a.y);   // 先处理位置低的
    for (const p of pending) {
      if (p.w < 70) warnings.push(`${tag}: 平台宽 ${p.w}px 偏窄`);
      let rise = Infinity;
      for (const s of supports) {
        const overlap = Math.min(p.x + p.w, s.to) - Math.max(p.x, s.from);
        if (overlap >= 24) rise = Math.min(rise, s.y - p.y);
      }
      if (rise === Infinity) {
        errors.push(`${tag}: 平台 [${p.x}, ${p.x + p.w}] 下方无任何可借力落脚点，跳不上去`);
      } else if (rise > MAX_RISE) {
        errors.push(`${tag}: 平台 [${p.x}, ${p.x + p.w}] 抬升 ${Math.round(rise)}px 超过 ${MAX_RISE}px（无中间跳板）`);
      } else if (rise <= 0) {
        errors.push(`${tag}: 平台 [${p.x}, ${p.x + p.w}] 与支撑同高或更低，布局浪费`);
      }
      supports.push({ y: p.y, from: p.x, to: p.x + p.w });
    }
  } else {
    for (const p of L.plat) {
      const rise = GROUND_TOP - p.y;
      if (rise < 20 || rise > 230) errors.push(`${tag}: 平台抬升 ${rise}px 明显异常（手作关公差 20~230）`);
    }
  }

  /* 敌人巡逻范围：必须在同一地面段内，且不覆盖出生点/检查点/终点 */
  for (const f of L.foes) {
    const a = segOf(L.ground, f.from);
    const b = segOf(L.ground, f.to);
    if (!a || !b || a !== b) errors.push(`${tag}: 敌人巡逻范围跨坑或悬空 [${f.from}, ${f.to}]`);
    if (!(f.speed > 0)) errors.push(`${tag}: 敌人速度非法`);
    if (f.from <= L.spawn.x + 120 && f.to >= L.spawn.x - 120) errors.push(`${tag}: 敌人巡逻覆盖出生点`);
    if (f.from <= L.checkpoint.x && f.to >= L.checkpoint.x) errors.push(`${tag}: 敌人巡逻覆盖检查点`);
    if (f.from <= L.goal.x && f.to >= L.goal.x) errors.push(`${tag}: 敌人巡逻覆盖终点`);
  }

  /* 金币不能埋进地面 */
  for (const c of L.coins) {
    if (c.y >= GROUND_TOP - 10) errors.push(`${tag}: 金币 y=${c.y} 埋在地面里`);
    if (c.x < 0 || c.x > L.width) errors.push(`${tag}: 金币 x=${c.x} 超出关卡宽度`);
  }

  if (L.coins.length < 3) warnings.push(`${tag}: 金币只有 ${L.coins.length} 个`);
});

const gen = LEVELS.length - 3;
const summary = [
  `关卡总数: ${LEVELS.length}（手作 3 + 程序生成 ${gen}）`,
  `几何错误: ${errors.length}`,
  `提示项: ${warnings.length}`,
  `跳跃上限: 高度 ${ctx.__OUT__.FEEL ? 112 : 112}px / 水平 ≈${Math.round(320 * (0.35 + Math.sqrt((2 * 112) / 3291.4)))}px`,
  `判定阈值: 坑宽 ≤${MAX_GAP}px（安全线 ${SAFE_GAP}）、平台抬升 ≤${MAX_RISE}px`
];
console.log(summary.join('\n'));

if (warnings.length) {
  console.log('\n提示（不影响通过）:');
  warnings.slice(0, 10).forEach((w) => console.log('  · ' + w));
  if (warnings.length > 10) console.log(`  … 共 ${warnings.length} 条`);
}

if (errors.length) {
  console.log('\n错误:');
  errors.slice(0, 20).forEach((e) => console.log('  ✗ ' + e));
  if (errors.length > 20) console.log(`  … 共 ${errors.length} 条`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ ${LEVELS.length} 关几何校验全部通过`);
}
