/**
 * 牌型评估器（德州扑克）
 * evaluate7: 从 7 张牌中选出最佳 5 张，返回可比较的分数与牌型名
 *
 * 分数编码为降序数组 [类别, 关键牌点...]:
 *   8 同花顺(皇家=最高的同花顺) / 7 四条 / 6 葫芦 / 5 同花
 *   4 顺子 / 3 三条 / 2 两对 / 1 一对 / 0 高牌
 * 比较时逐位比较即可。
 */

const CATEGORY_NAMES = {
  8: '同花顺',
  7: '四条',
  6: '葫芦',
  5: '同花',
  4: '顺子',
  3: '三条',
  2: '两对',
  1: '一对',
  0: '高牌',
};

/** 评估 5 张牌，返回分数数组 */
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);

  // 统计点数出现次数 → groups: [{rank, count}] 按 count 降序、rank 降序
  const count = {};
  for (const r of ranks) count[r] = (count[r] || 0) + 1;
  const groups = Object.keys(count)
    .map(Number)
    .sort((a, b) => count[b] - count[a] || b - a);

  // 顺子判断（含 A-2-3-4-5 特殊轮子）
  let straightHigh = 0;
  const uniq = [...new Set(ranks)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // 轮子 A2345
  }

  const byCount = (n) => groups.filter((r) => count[r] === n);

  if (isFlush && straightHigh) return [8, straightHigh];
  if (byCount(4).length === 1) return [7, byCount(4)[0], byCount(1)[0]];
  if (byCount(3).length === 1 && byCount(2).length === 1)
    return [6, byCount(3)[0], byCount(2)[0]];
  if (isFlush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (byCount(3).length === 1) return [3, byCount(3)[0], ...byCount(1)];
  if (byCount(2).length === 2) {
    const pairs = byCount(2).sort((a, b) => b - a);
    return [2, pairs[0], pairs[1], byCount(1)[0]];
  }
  if (byCount(2).length === 1) return [1, byCount(2)[0], ...byCount(1)];
  return [0, ...ranks];
}

/** 分数数组逐位比较: >0 则 a 胜 */
function cmpScore(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 评估 5 ~ 7 张牌（翻牌 5 张 / 转牌 6 张 / 河牌 7 张），
 * 枚举 C(n,5) 组合求最佳，返回 { score, category, name, best5 }
 * 少于 5 张返回 null
 */
function evaluate7(cards) {
  if (!cards || cards.length < 5) return null;
  const n = cards.length;
  let best = null;
  const walk = (start, chosen) => {
    if (chosen.length === 5) {
      const score = evaluate5(chosen);
      if (!best || cmpScore(score, best.score) > 0) {
        best = { score, best5: chosen.slice() };
      }
      return;
    }
    for (let i = start; i <= n - (5 - chosen.length); i++) {
      walk(i + 1, [...chosen, cards[i]]);
    }
  };
  walk(0, []);
  const category = best.score[0];
  const name = category === 8 && best.score[1] === 14 ? '皇家同花顺' : CATEGORY_NAMES[category];
  return { score: best.score, category, name, best5: best.best5 };
}

/**
 * 从 evaluate7 结果中提取构成牌型的关键牌（用于摊牌高亮）：
 * 高牌 → 最大 1 张；一对/三条/四条 → 该点数的牌；两对 → 两对 4 张；
 * 顺子/同花/葫芦/同花顺 → 全部 5 张
 */
function highlightOf(ev) {
  if (!ev || !ev.best5) return [];
  const cat = ev.score[0];
  const five = ev.best5;
  switch (cat) {
    case 0: {
      const top = ev.score[1];
      return five.filter((c) => c.rank === top).slice(0, 1);
    }
    case 1:
    case 3:
    case 7:
      return five.filter((c) => c.rank === ev.score[1]);
    case 2: {
      const r1 = ev.score[1];
      const r2 = ev.score[2];
      return five.filter((c) => c.rank === r1 || c.rank === r2);
    }
    default: // 顺子/同花/葫芦/同花顺
      return five.slice();
  }
}

module.exports = { evaluate5, evaluate7, cmpScore, highlightOf };
