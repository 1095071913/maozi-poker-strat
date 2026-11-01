/** 牌型评估器（前端版，与 src/evaluator.js 逻辑一致）
 *  用于游戏进行中实时计算"我的手牌 + 公共牌"的最佳组合并高亮 */
(() => {
  const CATEGORY_NAMES = {
    8: '同花顺', 7: '四条', 6: '葫芦', 5: '同花',
    4: '顺子', 3: '三条', 2: '两对', 1: '一对', 0: '高牌',
  };

  function evaluate5(cards) {
    const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
    const isFlush = cards.every((c) => c.suit === cards[0].suit);
    const count = {};
    for (const r of ranks) count[r] = (count[r] || 0) + 1;
    const groups = Object.keys(count).map(Number).sort((a, b) => count[b] - count[a] || b - a);
    let straightHigh = 0;
    const uniq = [...new Set(ranks)];
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
    }
    const byCount = (n) => groups.filter((r) => count[r] === n);
    if (isFlush && straightHigh) return [8, straightHigh];
    if (byCount(4).length === 1) return [7, byCount(4)[0], byCount(1)[0]];
    if (byCount(3).length === 1 && byCount(2).length === 1) return [6, byCount(3)[0], byCount(2)[0]];
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

  function cmpScore(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }

  /** 支持 5 ~ 7 张牌（翻牌 5 张 / 转牌 6 张 / 河牌 7 张），枚举 C(n,5) 求最佳 */
  function evaluate7(cards) {
    if (!cards || cards.length < 5) return null;
    const n = cards.length;
    let best = null;
    const walk = (start, chosen) => {
      if (chosen.length === 5) {
        const score = evaluate5(chosen);
        if (!best || cmpScore(score, best.score) > 0) best = { score, best5: chosen.slice() };
        return;
      }
      for (let i = start; i <= n - (5 - chosen.length); i++) walk(i + 1, [...chosen, cards[i]]);
    };
    walk(0, []);
    const category = best.score[0];
    const name = category === 8 && best.score[1] === 14 ? '皇家同花顺' : CATEGORY_NAMES[category];
    return { score: best.score, category, name, best5: best.best5 };
  }

  /** 构成牌型的关键牌（同服务端规则） */
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
      default:
        return five.slice();
    }
  }

  window.Evaluator = { evaluate7, highlightOf, cmpScore };
})();
