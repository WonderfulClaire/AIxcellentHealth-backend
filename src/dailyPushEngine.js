// src/dailyPushEngine.js
// 每日健康小推送引擎（纯逻辑，零外部依赖，可独立单测）
//
// 设计目标：根据「用户画像 + 近期习惯」从内容库筛选**今日最相关的一条**健康小知识。
// - 分段 segment：elderly(≥60) | middle(40–59) | young(<40) | all
// - 目标匹配：profiles.goals 是自由文本数组，按 标签/关键词 子串匹配
// - 限制匹配：profiles.restrictions（如"膝盖不适"），avoidIf 命中则排除，boostIf 命中则加权
// - 习惯触发：近期 daily_records（睡眠/压力/精力/训练量）满足 trigger 时加权
// - 去重 + 轮转：排除近 7 天已推过的 tip；同一天对同用户确定性稳定，跨天轮换

/* ───────────────────────── 内容库 ─────────────────────────
 * 每条 tip：
 *  id        唯一标识
 *  segment   适用分段
 *  tags      目标标签（与 profiles.goals 语义对齐）
 *  keywords  用于子串匹配 goals / 习惯的自由词
 *  emoji     卡片图标
 *  title     标题
 *  body      正文（1–3 句，给得出"今天能做什么"）
 *  source    权威来源（让推送可信，老年段尤其重要）
 *  trigger   近期习惯触发条件（可选）：{field,op,value} 或数组
 *  avoidIf   命中任一限制则**排除**该 tip（如高冲击动作避开"膝盖不适"）
 *  boostIf   命中任一限制则加权（更对口的推送）
 */
export const TIPS = [
  // ───────── 老年（≥60）─────────
  {
    id: 'elder-resistance-muscle',
    segment: 'elderly',
    tags: ['增肌', '长寿', '改善体态'],
    keywords: ['肌肉', '肌少', '力量', '抗阻', '增肌', '老年'],
    emoji: '🏋️',
    title: '力量训练 vs 抗阻训练：哪个更保住老年人的肌肉量？',
    body: '多项系统综述（如 Journal of Cachexia, Sarcopenia and Muscle）一致表明：渐进式抗阻训练是延缓肌少症、保留肌肉量最有效的方法；日常说的"力量训练"与"抗阻训练"多指同一类训练。对 60+ 人群，每周 2–3 次、从中低负荷（自重、弹力带、坐姿腿举）起步逐步加量，配合足量蛋白质（1.0–1.2 g/kg/天），8–12 周可见肌肉量与步行速度改善。先做力量评估，慢病者需医生 / 康复师把关。',
    source: 'IWGOP / ACSM 老年运动指南；J Cachexia Sarcopenia Muscle 系统综述',
    boostIf: ['肌少', '关节', '术后康复'],
  },
  {
    id: 'elder-protein',
    segment: 'elderly',
    tags: ['增肌', '长寿'],
    keywords: ['蛋白质', '蛋白', '肌肉', '吃', '营养'],
    emoji: '🥚',
    title: '把蛋白质"匀"到三餐，比一顿猛吃更护肌',
    body: '老年肌肉合成对单次蛋白摄入有"阈值"（约每餐 0.4 g/kg）。把每日蛋白分到早中晚（早餐蛋+奶、午餐肉鱼、晚餐豆制品），比晚餐一顿集中摄入更能持续刺激肌肉合成，配合抗阻训练效果更佳。',
    source: 'PROTECT-R 等随机试验；营养学综述',
  },
  {
    id: 'elder-balance-fall',
    segment: 'elderly',
    tags: ['长寿'],
    keywords: ['跌倒', '平衡', '防摔', '摔倒'],
    emoji: '⚖️',
    title: '防跌倒从"单脚站"开始',
    body: '跌倒是 65+ 伤残主因。每天 2 组单脚站立（扶椅背，每侧 30s）、脚跟脚尖走直线，可显著改善平衡与步态；居家移除地毯 / 杂物、浴室加防滑垫与扶手同样关键。',
    source: 'WHO 老年跌倒预防指南',
    boostIf: ['平衡差', '头晕', '骨质疏松'],
  },
  {
    id: 'elder-vitd-bone',
    segment: 'elderly',
    tags: ['长寿'],
    keywords: ['维D', '维生素D', '骨', '钙', '骨质疏松'],
    emoji: '☀️',
    title: '维生素 D：不只是补钙的配角',
    body: '60+ 人群皮肤合成维 D 能力下降、户外活动少，缺乏率高。维 D 不足与骨密度下降、肌少、跌倒风险相关。建议检测 25(OH)D，目标 75–150 nmol/L；食补 + 适度日晒 + 必要时补充剂，并同时保证钙摄入。',
    source: 'Endocrine Society 维生素 D 临床实践指南',
    boostIf: ['骨质疏松', '骨折', '骨密度'],
  },
  {
    id: 'elder-aerobic-heart',
    segment: 'elderly',
    tags: ['增强心肺', '长寿'],
    keywords: ['心肺', '心脏', '有氧', '血压', '散步'],
    emoji: '🚶',
    title: '每天 20 分钟快走，给心脏"上保险"',
    body: '对老年人，低门槛有氧（快走、骑车、太极）每周累计 150 分钟，可改善血压、血糖与情绪。以"能说话但不能唱歌"的强度为宜，量力而行、避免屏气用力的动作。',
    source: 'AHA / WHO 老年体力活动指南',
  },

  // ───────── 中年（40–59）─────────
  {
    id: 'mid-metabolic',
    segment: 'middle',
    tags: ['减脂', '控糖'],
    keywords: ['代谢', '减脂', '胖', '腰', '内脏脂肪', '中年'],
    emoji: '🔥',
    title: '40 岁后别只盯体重，盯"腰围"',
    body: '中年代谢率下降、内脏脂肪更易堆积。腰围（男≥90cm、女≥85cm）比体重更能预示心血管与糖尿病风险。优先用"蛋白质 + 力量训练"保肌、用快走 / 间歇有氧减内脏脂肪，比单纯节食更可持续。',
    source: 'IDF 代谢综合征定义；AHA',
    boostIf: ['高血压', '糖尿病', '脂肪肝'],
  },
  {
    id: 'mid-hiit',
    segment: 'middle',
    tags: ['减脂', '增强心肺'],
    keywords: ['HIIT', '间歇', '时间少', '忙', '效率'],
    emoji: '⏱️',
    title: '没时间运动？HIIT 用 20 分钟换同等收益',
    body: '对中青年，每周 2–3 次、每次 20 分钟的高强度间歇（如快走 / 单车 30s 冲刺 + 90s 慢走）在改善心肺与胰岛素敏感性上接近更长时长的稳态有氧，且更省时。注意：高血压 / 心脏风险者先评估，避免空腹猛练。',
    source: 'ACSM 体能指南；JAMA 内部审计研究',
    avoidIf: ['高血压', '心脏', '心绞痛'],
    boostIf: ['时间少', '忙', '加班'],
  },
  {
    id: 'mid-sleep-cvd',
    segment: 'middle',
    tags: ['改善睡眠', '减压'],
    keywords: ['睡眠', '睡', '血压', '压力'],
    emoji: '😴',
    title: '睡不够 6 小时，血压更难控',
    body: '中年是高血压高发期，而睡眠不足会推高血压与皮质醇。尽量固定作息、睡前 1 小时远离蓝光与咖啡因，目标 7–8 小时。若长期打鼾 + 白天犯困，排查睡眠呼吸暂停。',
    source: 'AHA 睡眠与心血管健康科学声明',
    trigger: { field: 'sleep_hours', op: '<', value: 6.5 },
  },
  {
    id: 'mid-stress-cortisol',
    segment: 'middle',
    tags: ['减压', '提升精力'],
    keywords: ['压力', '焦虑', '累', ' burnout', '紧张'],
    emoji: '🧘',
    title: '把"深呼吸"写进会议间隙',
    body: '长期高压使皮质醇居高，影响睡眠、腰腹脂肪与免疫力。每天 3 次、每次 2 分钟箱式呼吸（吸 4-停 4-呼 4-停 4）可快速降交感张力；配合每周 2 次运动，效果更稳。',
    source: '心理生理学研究；APA 压力管理建议',
    trigger: { field: 'stress_level', op: '==', value: 'high' },
  },
  {
    id: 'mid-strength-base',
    segment: 'middle',
    tags: ['增肌', '改善体态'],
    keywords: ['力量', '肌肉', '体态', '肩颈', '腰椎'],
    emoji: '💪',
    title: '中年补"肌"，是给未来的自己存钱',
    body: '30 岁后每十年流失约 3–8% 肌肉，中年开始力量训练能显著延缓肌少、保护关节与代谢。从深蹲、硬拉、推举的轻重量多组数起步，每周 2 次全身循环，比追求大重量更安全有效。',
    source: 'ACSM / 运动医学共识',
  },

  // ───────── 青年（<40）─────────
  {
    id: 'young-rest-ultradian',
    segment: 'young',
    tags: ['提升精力'],
    keywords: ['精力', '专注', '效率', '工作', '疲劳', '休息'],
    emoji: '🌿',
    title: '用 90 分钟周期工作，精力比"硬扛"更持久',
    body: '人的专注力遵循超日节律（ultradian rhythm）：约 90–120 分钟高强度专注后需要 15–20 分钟真正休息。把大块任务切成 90 分钟段，段间离开屏幕、走动 / 日晒 / 闭眼，比连熬 4 小时更能维持全天高质量产出。',
    source: '超日节律研究（Rossi 等）；组织行为学综述',
    boostIf: ['加班', '久坐', '忙'],
    trigger: { field: 'energy_level', op: '<=', value: 2 },
  },
  {
    id: 'young-sleep-hygiene',
    segment: 'young',
    tags: ['改善睡眠', '提升精力'],
    keywords: ['睡眠', '睡', '熬夜', '失眠'],
    emoji: '🌙',
    title: '高质量休息从"固定起床时间"开始',
    body: '年轻人常靠补觉还债，但生物钟更认"固定起床点"。哪怕前一晚晚睡，也尽量同一时间起，白天晒晨光 10 分钟，晚上 23 点前降蓝光。咖啡因半衰期约 5–6 小时，下午 2 点后尽量不喝。',
    source: '美国睡眠医学会（AASM）睡眠卫生建议',
    trigger: { field: 'sleep_hours', op: '<', value: 6.5 },
  },
  {
    id: 'young-sedentary',
    segment: 'young',
    tags: ['提升精力'],
    keywords: ['久坐', '低头', '颈椎', '腰', '办公'],
    emoji: '🪑',
    title: '每坐 1 小时，站起来 2 分钟',
    body: '久坐与代谢下降、颈腰劳损强相关。设个提醒：每小时起身接水 / 拉伸 / 深蹲 10 个；用站立办公或步行会议替代部分坐姿，全天零散活动量可观，且能立刻回血精力。',
    source: '久坐行为研究（如 Annals of Internal Medicine）',
    boostIf: ['久坐', '加班'],
  },
  {
    id: 'young-caffeine',
    segment: 'young',
    tags: ['改善睡眠'],
    keywords: ['咖啡', '咖啡因', '提神'],
    emoji: '☕',
    title: '想提神又不想失眠？卡好咖啡因的"截止线"',
    body: '咖啡因半衰期约 5–6 小时，下午摄入会拖慢入睡。需要白天提神时放在上午，并配合小睡（10–20 分钟"咖啡盹"效果最佳）；用补水 + 光照替代下午的第三杯咖啡，晚上更好睡。',
    source: '睡眠药理学研究',
    trigger: { field: 'sleep_hours', op: '<', value: 6.5 },
  },
  {
    id: 'young-strength-young',
    segment: 'young',
    tags: ['增肌', '改善体态'],
    keywords: ['力量', '体态', '含胸', '健身', '塑性'],
    emoji: '🏋️',
    title: '20–30 岁是练体态的黄金窗口',
    body: '年轻时代谢好、恢复快，是纠正圆肩 / 骨盆前倾、建立动作模式的良机。每周 2–3 次复合动作（深蹲、硬拉、划船、推举）打基础，比只练胸腹更预防久坐带来的代偿性劳损。',
    source: '运动训练学共识',
  },
  {
    id: 'young-screen-eye',
    segment: 'young',
    tags: ['提升精力'],
    keywords: ['眼', '屏幕', '视疲劳', '干眼', '视力'],
    emoji: '👀',
    title: '20-20-20：每 20 分钟看 20 英尺外 20 秒',
    body: '长时间盯屏易视疲劳、干眼、注意力下滑。用 20-20-20 法则给眼睛"松绑"，并调高环境光、把屏幕放略低于视线，减少眩光。这比滴眼药水更治本。',
    source: '美国验光协会（AOA）建议',
  },

  // ───────── 通用（all）─────────
  {
    id: 'all-water',
    segment: 'all',
    tags: [],
    keywords: ['水', '喝水', '脱水'],
    emoji: '💧',
    title: '轻度缺水就会拉低专注力',
    body: '体液下降 1–2% 即可影响注意力与情绪。每天 1.5–2L 水（因人而异、随活动 / 气温上调），把水杯放手边、饭前一杯，是最便宜的"精力补剂"。',
    trigger: { field: 'energy_level', op: '<=', value: 2 },
  },
  {
    id: 'all-walk',
    segment: 'all',
    tags: [],
    keywords: ['走', '步', '散步'],
    emoji: '🚶',
    title: '8000 步是个"甜点区"',
    body: '研究提示每日约 8000 步与显著更低的全因死亡风险相关，且收益在 8000 步附近趋稳——不必逼自己 2 万步。通勤走路、饭后散步都能轻松凑数。',
    source: 'JAMA Neurology / 步数队列研究',
  },
  {
    id: 'all-mindful',
    segment: 'all',
    tags: ['减压'],
    keywords: ['正念', '冥想', '放松', '焦虑'],
    emoji: '🧘',
    title: '3 分钟正念，给大脑"清缓存"',
    body: '短暂正念（专注呼吸 / 身体扫描）可降低焦虑、提升后续专注。不需要 App，等电梯、排队时就能做；关键在于把注意力拉回当下，而非清空念头。',
  },
  {
    id: 'all-fiber',
    segment: 'all',
    tags: ['控糖', '减脂'],
    keywords: ['纤维', '蔬菜', '肠道', '便秘', '杂粮'],
    emoji: '🥦',
    title: '把"蔬菜占一半盘子"变成默认',
    body: '充足膳食纤维（25–30g/天）有助于肠道、血糖平稳与饱腹。每餐让蔬菜占餐盘一半、主食换一部分全谷、加豆类坚果，比算热量更容易长期坚持。',
    source: '膳食指南（中国居民 / USDA）',
  },
];

/* ───────────────────────── 工具函数 ───────────────────────── */

const CURRENT_YEAR = () => new Date().getFullYear();

export function ageFromBirthYear(birthYear) {
  if (!birthYear || birthYear < 1900 || birthYear > CURRENT_YEAR()) return null;
  return CURRENT_YEAR() - birthYear;
}

export function segmentFromAge(age) {
  if (age == null) return 'all';
  if (age >= 60) return 'elderly';
  if (age >= 40) return 'middle';
  return 'young';
}

// 简单字符串哈希（djb2），用于按"用户+日期"确定性选 tip
export function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return h >>> 0; // 转无符号 32 位
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

// goals / restrictions 可能是 DB 里的 JSON 字符串，统一成数组
export function toArr(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.map(norm);
    } catch {
      /* 非 JSON，按逗号拆分 */
    }
    return s.split(/[,，、]/).map(norm).filter(Boolean);
  }
  return [];
}

function goalMatches(tip, goals) {
  if (!goals.length) return 0;
  const keys = [...(tip.tags || []), ...(tip.keywords || [])].map(norm);
  let n = 0;
  for (const g of goals) {
    for (const k of keys) {
      if (g.includes(k) || k.includes(g)) {
        n++;
        break;
      }
    }
  }
  return n;
}

function restrictionBoost(tip, restrictions) {
  if (!restrictions.length || !tip.boostIf) return 0;
  const boost = tip.boostIf.map(norm);
  return restrictions.some((r) => boost.some((b) => r.includes(b) || b.includes(r))) ? 1 : 0;
}

function restrictionForbidden(tip, restrictions) {
  if (!restrictions.length || !tip.avoidIf) return false;
  const avoid = tip.avoidIf.map(norm);
  return restrictions.some((r) => avoid.some((a) => r.includes(a) || a.includes(r)));
}

function matchTrigger(trigger, recent) {
  if (!trigger || !recent) return false;
  const checks = Array.isArray(trigger) ? trigger : [trigger];
  return checks.some((t) => {
    const v = recent[t.field];
    if (v == null) return false;
    switch (t.op) {
      case '<':
        return v < t.value;
      case '<=':
        return v <= t.value;
      case '>':
        return v > t.value;
      case '>=':
        return v >= t.value;
      case '==':
        return String(v).toLowerCase() === String(t.value).toLowerCase();
      default:
        return false;
    }
  });
}

/**
 * 对单条 tip 打分（<0 表示应被排除）。
 */
export function scoreTip(tip, ctx) {
  const { segment, goals = [], restrictions = [], recent = null } = ctx;
  // 分段不符 → 排除
  if (tip.segment !== 'all' && tip.segment !== segment) return -1;
  let score = tip.segment === segment ? 12 : 3; // 同分段高权，all 兜底低权
  score += goalMatches(tip, goals) * 4;
  score += restrictionBoost(tip, restrictions) * 3;
  if (matchTrigger(tip.trigger, recent)) score += 5;
  return score;
}

/**
 * 根据上下文筛选今日 tip。
 * @param {object} ctx { userId, date, segment, goals[], restrictions[], recent }
 * @param {Set<string>} excludeIds 近 N 天已推过的 tip id（去重）
 * @returns {object|null} 选中的 tip
 */
export function pickTipForUser(ctx, excludeIds = new Set()) {
  const candidates = TIPS.filter((t) => {
    if (scoreTip(t, ctx) < 0) return false;
    if (excludeIds.has(t.id)) return false;
    if (restrictionForbidden(t, ctx.restrictions || [])) return false;
    return true;
  });

  if (!candidates.length) {
    // 兜底：仍尽量避开已推过的 tip；优先同分段，其次通用段，再次任意未推过的
    const fallback =
      TIPS.find((t) => t.segment === ctx.segment && !excludeIds.has(t.id)) ||
      TIPS.find((t) => t.segment === 'all' && !excludeIds.has(t.id)) ||
      TIPS.find((t) => !excludeIds.has(t.id)) ||
      TIPS[0];
    return fallback || null;
  }

  // 按分数降序；同分时用"用户+日期"哈希做确定性轮转，保证当天稳定、跨天变化
  candidates.sort((a, b) => scoreTip(b, ctx) - scoreTip(a, ctx));
  const topK = Math.min(candidates.length, 5);
  const pool = candidates.slice(0, topK);
  const seed = hashStr(`${ctx.userId || ''}|${ctx.date || ''}`);
  const chosen = pool[seed % pool.length];
  return chosen;
}

// 便捷：从 birthYear 直接算分段
export function segmentFromBirthYear(birthYear) {
  return segmentFromAge(ageFromBirthYear(birthYear));
}
