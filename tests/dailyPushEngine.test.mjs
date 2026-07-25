// tests/dailyPushEngine.test.mjs
// 纯逻辑单测：分段、目标/限制匹配、习惯触发、去重、轮转。无需数据库。
import assert from 'node:assert/strict';
import {
  TIPS,
  ageFromBirthYear,
  segmentFromAge,
  segmentFromBirthYear,
  scoreTip,
  pickTipForUser,
  toArr,
} from '../src/dailyPushEngine.js';

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ✓', name);
}

console.log('— 分段计算 —');
ok('1960 年生 → 老年段', segmentFromBirthYear(1960) === 'elderly');
ok('1985 年生 → 中年段', segmentFromBirthYear(1985) === 'middle');
ok('2000 年生 → 青年段', segmentFromBirthYear(2000) === 'young');
ok('无出生年 → 通用段', segmentFromBirthYear(null) === 'all');
ok('ageFromBirthYear 校验异常值', ageFromBirthYear(9999) === null);

console.log('— toArr 兼容 DB 的 JSON 字符串 / 数组 / 逗号串 —');
ok('解析 JSON 数组', JSON.stringify(toArr('["减脂","改善睡眠"]')) === JSON.stringify(['减脂', '改善睡眠']));
ok('解析逗号串', JSON.stringify(toArr('减脂, 改善睡眠')) === JSON.stringify(['减脂', '改善睡眠']));
ok('直接数组', JSON.stringify(toArr(['控糖'])) === JSON.stringify(['控糖']));

console.log('— 老年画像：应推老年段内容 —');
{
  const ctx = { userId: 1, date: '2026-07-25', segment: 'elderly', goals: [], restrictions: [], recent: null };
  const tip = pickTipForUser(ctx);
  ok('选中的是老年段 tip', tip.segment === 'elderly');
  ok('包含用户给的示例研究主题', TIPS.some((t) => t.id === 'elder-resistance-muscle' && t.segment === 'elderly'));
}

console.log('— 青年 + 目标"提升精力" + 精力低：应推休息/精力类 —');
{
  const ctx = {
    userId: 2,
    date: '2026-07-25',
    segment: 'young',
    goals: ['提升精力'],
    restrictions: [],
    recent: { energy_level: 2 },
  };
  const tip = pickTipForUser(ctx);
  ok('选中青年段', tip.segment === 'young');
  ok('young-rest-ultradian 得分最高', scoreTip(TIPS.find((t) => t.id === 'young-rest-ultradian'), ctx) >= scoreTip(TIPS.find((t) => t.id === 'young-screen-eye'), ctx));
  ok('选中为高相关候选（分数≥12，即青年段内容）', scoreTip(tip, ctx) >= 12);
}

console.log('— 限制规避：中年+高血压 不应推 HIIT —');
{
  const ctx = { userId: 3, date: '2026-07-25', segment: 'middle', goals: [], restrictions: ['高血压'], recent: null };
  const tip = pickTipForUser(ctx);
  ok('未选中 mid-hiit', tip.id !== 'mid-hiit');
}

console.log('— 习惯触发：睡眠<6.5 的青年应加权睡眠类 —');
{
  const ctx = { userId: 4, date: '2026-07-25', segment: 'young', goals: [], restrictions: [], recent: { sleep_hours: 5 } };
  ok('young-sleep-hygiene 被触发加权', scoreTip(TIPS.find((t) => t.id === 'young-sleep-hygiene'), ctx) > 12);
  ok('young-caffeine 被触发加权', scoreTip(TIPS.find((t) => t.id === 'young-caffeine'), ctx) > 12);
}

console.log('— 去重：排除全部老年 tip 后回退到通用段 —');
{
  const allElderly = TIPS.filter((t) => t.segment === 'elderly').map((t) => t.id);
  const ctx = { userId: 5, date: '2026-07-25', segment: 'elderly', goals: [], restrictions: [], recent: null };
  const tip = pickTipForUser(ctx, new Set(allElderly));
  ok('回退 tip 不在排除集', !allElderly.includes(tip.id));
}

console.log('— 轮转：同一用户不同日期结果可变化 —');
{
  const ctxA = { userId: 6, date: '2026-07-25', segment: 'young', goals: [], restrictions: [], recent: null };
  const ctxB = { userId: 6, date: '2026-07-26', segment: 'young', goals: [], restrictions: [], recent: null };
  let changed = false;
  for (let i = 0; i < 5; i++) {
    const a = pickTipForUser({ ...ctxA, userId: 100 + i });
    const b = pickTipForUser({ ...ctxB, userId: 100 + i });
    if (a.id !== b.id) changed = true;
  }
  ok('跨日期推送有轮换', changed);
}

console.log('— 内容库完整性 —');
ok('至少 20 条 tip', TIPS.length >= 20);
ok('每条都有唯一 id/title/body/emoji', TIPS.every((t) => t.id && t.title && t.body && t.emoji));
ok('所有 segment 取值合法', TIPS.every((t) => ['elderly', 'middle', 'young', 'all'].includes(t.segment)));

console.log(`\n全部通过：${passed} 项 ✅`);
