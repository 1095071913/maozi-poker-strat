/**
 * 核心逻辑自测（无测试框架，直接 node 运行）
 * 用法: node test/logic.test.js
 */
const assert = require('assert');
const { evaluate7, cmpScore } = require('../src/evaluator');
const { cardText } = require('../src/cards');
const Game = require('../src/game');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

const C = (s) => {
  // "A♠" / "10♥" 格式解析
  const m = s.match(/^([2-9]|10|J|Q|K|A)([♠♥♦♣])$/);
  const rankMap = { J: 11, Q: 12, K: 13, A: 14 };
  const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
  const rank = rankMap[m[1]] || Number(m[1]);
  return { rank, suit: suitMap[m[2]] };
};

console.log('\n[牌型评估]');

test('皇家同花顺', () => {
  const r = evaluate7([C('A♠'), C('K♠'), C('Q♠'), C('J♠'), C('10♠'), C('2♥'), C('3♦')]);
  assert.strictEqual(r.name, '皇家同花顺');
});

test('同花顺', () => {
  const r = evaluate7([C('9♠'), C('K♠'), C('8♠'), C('7♠'), C('6♠'), C('5♠'), C('3♦')]);
  assert.strictEqual(r.name, '同花顺');
  const noFlushStraight = evaluate7([C('9♠'), C('K♠'), C('8♠'), C('7♠'), C('6♥'), C('5♠'), C('3♦')]);
  assert.notStrictEqual(noFlushStraight.name, '同花顺');
});

test('轮子顺 A2345 高牌为5', () => {
  const wheel = evaluate7([C('A♠'), C('2♥'), C('3♦'), C('4♣'), C('5♠'), C('K♥'), C('Q♦')]);
  assert.strictEqual(wheel.name, '顺子');
  assert.strictEqual(wheel.score[1], 5);
  const six = evaluate7([C('2♥'), C('3♦'), C('4♣'), C('5♠'), C('6♥'), C('K♥'), C('Q♦')]);
  assert.ok(cmpScore(six.score, wheel.score) > 0, '6高顺子应胜过轮子');
});

test('四条 > 葫芦', () => {
  const quads = evaluate7([C('7♠'), C('7♥'), C('7♦'), C('7♣'), C('2♠'), C('3♥'), C('4♦')]);
  const boat = evaluate7([C('A♠'), C('A♥'), C('A♦'), C('K♣'), C('K♠'), C('2♥'), C('3♦')]);
  assert.strictEqual(quads.name, '四条');
  assert.strictEqual(boat.name, '葫芦');
  assert.ok(cmpScore(quads.score, boat.score) > 0);
});

test('踢脚比较: AA K 击败 AA Q', () => {
  const a = evaluate7([C('A♠'), C('A♥'), C('K♦'), C('5♣'), C('5♠'), C('2♥'), C('3♦')]); // 两对 A5
  const b = evaluate7([C('A♦'), C('A♣'), C('Q♦'), C('5♥'), C('5♦'), C('2♠'), C('3♠')]); // 两对 A5 踢脚 Q vs K? 同为 A5
  // a 的最佳是 A A K 5 5? 不: 两对是 A 和 5, 踢脚 K
  assert.ok(cmpScore(a.score, b.score) > 0, `期望 ${a.score} > ${b.score}`);
});

test('7选5: 公共牌对子 + 手牌口袋对', () => {
  const r = evaluate7([C('K♠'), C('K♥'), C('2♦'), C('2♣'), C('9♠'), C('9♥'), C('A♦')]);
  assert.strictEqual(r.name, '两对');
});

console.log('\n[摊牌高亮 · 关键牌]');

const { highlightOf } = require('../src/evaluator');

test('高牌只亮最大 1 张', () => {
  const r = evaluate7([C('A♠'), C('K♥'), C('9♦'), C('7♣'), C('5♠'), C('3♥'), C('2♦')]);
  const hl = highlightOf(r);
  assert.strictEqual(hl.length, 1);
  assert.strictEqual(hl[0].rank, 14);
});

test('一对亮 2 张、两对亮 4 张、三条亮 3 张、四条亮 4 张', () => {
  const pair = highlightOf(evaluate7([C('9♠'), C('9♥'), C('K♦'), C('7♣'), C('5♠'), C('3♥'), C('2♦')]));
  assert.strictEqual(pair.length, 2);
  assert.ok(pair.every((c) => c.rank === 9));

  const two = highlightOf(evaluate7([C('9♠'), C('9♥'), C('K♦'), C('K♣'), C('5♠'), C('3♥'), C('2♦')]));
  assert.strictEqual(two.length, 4);

  const trips = highlightOf(evaluate7([C('9♠'), C('9♥'), C('9♦'), C('K♣'), C('5♠'), C('3♥'), C('2♦')]));
  assert.strictEqual(trips.length, 3);

  const quads = highlightOf(evaluate7([C('9♠'), C('9♥'), C('9♦'), C('9♣'), C('5♠'), C('3♥'), C('2♦')]));
  assert.strictEqual(quads.length, 4);
  assert.ok(quads.every((c) => c.rank === 9));
});

test('顺子/同花/葫芦/同花顺亮全部 5 张', () => {
  const straight = highlightOf(evaluate7([C('5♠'), C('6♥'), C('7♦'), C('8♣'), C('9♠'), C('K♥'), C('2♦')]));
  assert.strictEqual(straight.length, 5);

  const flush = highlightOf(evaluate7([C('A♠'), C('K♠'), C('9♠'), C('7♠'), C('5♠'), C('3♥'), C('2♦')]));
  assert.strictEqual(flush.length, 5);
  assert.ok(flush.every((c) => c.suit === 's'));

  const boat = highlightOf(evaluate7([C('9♠'), C('9♥'), C('9♦'), C('K♣'), C('K♠'), C('3♥'), C('2♦')]));
  assert.strictEqual(boat.length, 5);

  const sf = highlightOf(evaluate7([C('5♠'), C('6♠'), C('7♠'), C('8♠'), C('9♠'), C('K♥'), C('2♦')]));
  assert.strictEqual(sf.length, 5);
});


test('超额全下的未跟注部分退回，不产生第二个胜者', () => {
  const { game } = mockRoom(
    { initialChips: 5000, sb: 10, bb: 20, maxPlayers: 2 },
    [{ name: 'A', chips: 2000 }, { name: 'B', chips: 3000 }]
  );
  game.startHand();
  // A 全下 2000 → B 超额全下 3000（未被跟注的 1000 应退回）
  driveTo(game, 'A');
  game.act(game.players.find((x) => x.name === 'A').id, { type: 'raise', amount: 2000 });
  driveTo(game, 'B');
  game.act(game.players.find((x) => x.name === 'B').id, { type: 'raise', amount: 3000 });
  // 双方全下 → 自动发完牌摊牌
  game.flushTimers();
  while (game.phase === 'playing') game.flushTimers();

  assert.ok(['handEnd', 'gameOver'].includes(game.phase), '应处于结算或随后自动终局');
  assert.strictEqual(game.result.winners.length, 1, '只应有一个胜者');
  assert.strictEqual(game.result.winners[0].amount, 4000, '竞争胜者只赢主池 4000');
  const a = game.players.find((x) => x.name === 'A');
  const b = game.players.find((x) => x.name === 'B');
  const loser = a.winAmount > 0 ? b : a;
  assert.strictEqual(loser.winAmount, 0, '另一方不算胜者');
  assert.strictEqual(b.returned, 1000, '超额下注方 B 未被跟注的 1000 退回（无论输赢）');
  // 筹码守恒：2000 + 3000 = 5000
  assert.strictEqual(a.chips + b.chips, 5000);
});

console.log('\n[牌局引擎 · 模拟]');

/** 构造一个模拟 Room（拦截广播） */
function mockRoom(settings, playerDefs) {
  const room = {
    settings,
    players: playerDefs.map((d, i) => ({
      id: i + 1,
      name: d.name,
      seat: i,
      chips: d.chips,
      online: true,
      socketId: `sock-${i + 1}`,
      isOwner: i === 0,
      inHand: false,
      cards: [],
      betRound: 0,
      totalCommitted: 0,
      folded: false,
      allin: false,
      out: false,
      lastAction: null,
      winAmount: 0,
      handName: null,
      revealed: false,
    })),
    broadcastRoom() {},
    broadcastGame() {},
    broadcastAll() {},
    recordChampion() {},
  };
  const game = new Game(room, settings);
  room.game = game;
  return { room, game };
}

function actOk(game, playerName, type, amount) {
  const p = game.players.find((x) => x.name === playerName);
  const res = game.act(p.id, { type, amount });
  if (!res.ok) throw new Error(`${playerName} ${type} ${amount ?? ''} 被拒绝: ${res.error}`);
  return res;
}

function chips(game, name) {
  return game.players.find((p) => p.name === name).chips;
}

test('两人各下一注后摊牌，底池归赢家', () => {
  const { game } = mockRoom(
    { initialChips: 1000, sb: 10, bb: 20, maxPlayers: 2 },
    [{ name: 'A', chips: 1000 }, { name: 'B', chips: 1000 }]
  );
  game.startHand();
  // heads-up 翻牌前: 按钮(小盲)先行动
  const btn = game.handPlayers.find((p) => p.seat === game.buttonSeat);
  const other = game.handPlayers.find((p) => p !== btn);
  assert.strictEqual(game.toActSeat, btn.seat, '翻牌前应由按钮(小盲)先行动');
  actOk(game, btn.name, 'call'); // SB 补 10
  actOk(game, other.name, 'check'); // BB 过牌
  // heads-up 翻牌后: BB 先行动
  assert.strictEqual(game.street, 'flop');
  assert.strictEqual(game.toActSeat, other.seat, '翻牌后应由大盲先行动');
  for (const street of ['flop', 'turn', 'river']) {
    actOk(game, other.name, 'check');
    actOk(game, btn.name, 'check');
  }
  assert.strictEqual(game.phase, 'handEnd', '河牌结束应进入结算');
  const totalWin = game.result.winners.reduce((s, w) => s + w.amount, 0);
  assert.strictEqual(totalWin, 40, '赢家赢额合计应为 40（两盲注合计，允许平分）');
  const chipsSum = game.players.reduce((s, p) => s + p.chips, 0);
  assert.strictEqual(chipsSum, 2000, '双方筹码守恒');
});

test('其余玩家全弃牌，唯一玩家直接收池', () => {
  const { game } = mockRoom(
    { initialChips: 1000, sb: 10, bb: 20, maxPlayers: 3 },
    [{ name: 'A', chips: 1000 }, { name: 'B', chips: 1000 }, { name: 'C', chips: 1000 }]
  );
  game.startHand();
  const order = game.handPlayers.map((p) => p.seat);
  const bbIdx = order.indexOf(game.bbSeat);
  // UTG(大盲下一位) -> SB -> BB
  const utg = game.handPlayers[(bbIdx + 1) % 3];
  actOk(game, utg.name, 'fold');
  // 接下来是小盲
  const sbP = game.handPlayers.find((p) => p.seat === game.sbSeat);
  actOk(game, sbP.name, 'fold');
  assert.strictEqual(game.phase, 'handEnd');
  const w = game.result.winners[0];
  const bbP = game.players.find((p) => p.seat === game.bbSeat);
  assert.strictEqual(w.name, bbP.name, '大盲未行动应直接赢池');
  assert.strictEqual(w.amount, 30, '池 = SB10 + BB20');
});

test('加注后重新开放行动权（大盲获得再加注机会）', () => {
  const { game } = mockRoom(
    { initialChips: 1000, sb: 10, bb: 20, maxPlayers: 3 },
    [{ name: 'A', chips: 1000 }, { name: 'B', chips: 1000 }, { name: 'C', chips: 1000 }]
  );
  game.startHand();
  const utg = game.handPlayers[(game.handPlayers.findIndex((p) => p.seat === game.bbSeat) + 1) % 3];
  assert.strictEqual(game.toActSeat, utg.seat, '翻牌前应从大盲下一位开始行动');
  actOk(game, utg.name, 'raise', 60);
  // 另外两人依次跟注 → 三家入池翻牌
  while (game.phase === 'playing' && game.street === 'preflop') autoCall(game);
  assert.strictEqual(game.street, 'flop', '三人跟注后应进入翻牌');
  // 翻牌圈从 SB 开始
  const sbP = game.handPlayers.find((p) => p.seat === game.sbSeat);
  assert.strictEqual(game.toActSeat, sbP.seat, '翻牌圈应由小盲先行动');
});

test('最小加注校验', () => {
  const { game } = mockRoom(
    { initialChips: 1000, sb: 10, bb: 20, maxPlayers: 3 },
    [{ name: 'A', chips: 1000 }, { name: 'B', chips: 1000 }, { name: 'C', chips: 1000 }]
  );
  game.startHand();
  const utg = game.handPlayers[(game.handPlayers.findIndex((p) => p.seat === game.bbSeat) + 1) % 3];
  const p = game.players.find((x) => x.name === utg.name);
  const bad = game.act(p.id, { type: 'raise', amount: 30 }); // 需 >= 20+20=40
  assert.ok(!bad.ok, '加注到 30 应被拒绝');
});

/** 自动让当前行动者过牌/跟注 */
function autoCall(game) {
  const p = game.handPlayers.find((x) => x.seat === game.toActSeat);
  if (!p) throw new Error('无人可行动');
  return game.act(p.id, { type: p.betRound >= game.currentBet ? 'check' : 'call' });
}

/** 驱动其他人行动，直到轮到指定玩家 */
function driveTo(game, name) {
  let guard = 0;
  while (game.phase === 'playing') {
    const p = game.handPlayers.find((x) => x.seat === game.toActSeat);
    if (!p) throw new Error('无人可行动');
    if (p.name === name) return;
    if (guard++ > 30) throw new Error('driveTo 陷入死循环');
    const r = autoCall(game);
    if (!r.ok) throw new Error(`driveTo 行动失败: ${r.error}`);
  }
  throw new Error(`牌局在轮到 ${name} 前结束`);
}

test('All-in 边池分层：短码只能赢主池', () => {
  const { game } = mockRoom(
    { initialChips: 1000, sb: 10, bb: 20, maxPlayers: 3 },
    [{ name: '短码', chips: 100 }, { name: 'B', chips: 1000 }, { name: 'C', chips: 1000 }]
  );
  game.startHand();
  // preflop 全部跟注到翻牌
  while (game.phase === 'playing' && game.street === 'preflop') autoCall(game);
  assert.strictEqual(game.street, 'flop');
  // 短码全下（翻牌前已投入 20，再压 80）
  driveTo(game, '短码');
  const short = game.players.find((p) => p.name === '短码');
  assert.strictEqual(short.totalCommitted, 20, '翻牌前短码应投入 20');
  actOk(game, '短码', 'raise', short.betRound + short.chips);
  assert.ok(short.allin);
  // B 加注到 300 制造边池，C 跟注
  driveTo(game, 'B');
  actOk(game, 'B', 'raise', 300);
  driveTo(game, 'C');
  actOk(game, 'C', 'call');
  // 短码已 all-in；B/C 若仍有行动轮则打到摊牌
  while (game.phase === 'playing') autoCall(game);
  assert.strictEqual(game.phase, 'handEnd');

  const total = game.players.reduce((s, p) => s + p.totalCommitted, 0);
  const paid = game.result.winners.reduce((s, w) => s + w.amount, 0);
  assert.strictEqual(total, 100 + 320 + 320, '总投入 = 短码100 + B320 + C320');
  assert.strictEqual(paid, total, '分池总和必须等于总投入（筹码守恒）');
  // 短码总投入 100 → 无论牌面如何，最多只能赢主池 300
  const shortWin = game.players.find((p) => p.name === '短码').winAmount;
  assert.ok(shortWin <= 300, `短码赢额 ${shortWin} 不应超过主池 300`);
});

test('筹码守恒：多局随机对战后总筹码不变', () => {
  const names = ['A', 'B', 'C', 'D', 'E'];
  const defs = names.map((n) => ({ name: n, chips: 500 }));
  const { game } = mockRoom({ initialChips: 500, sb: 5, bb: 10, maxPlayers: 5 }, defs);
  game.startHand();

  let guard = 0;
  while (game.phase !== 'gameOver' && guard++ < 20000) {
    if (game.phase === 'handEnd') {
      // 准备制：所有有资格玩家点准备 → 自动开下一局
      const eligible = game.eligiblePlayers();
      if (eligible.length < 2) {
        game.endGame();
      } else {
        for (const p of eligible) {
          const r = game.ready(p.id);
          if (!r.ok) throw new Error(`准备失败: ${r.error}`);
        }
        if (game.phase === 'handEnd') throw new Error('全员准备后未自动开局');
      }
      continue;
    }
    if (game.phase !== 'playing') break;
    const seat = game.toActSeat;
    if (seat == null) {
      // 全下后逐街发牌（runOut）期间无行动者，同步推进定时器
      game.flushTimers();
      continue;
    }
    const p = game.handPlayers.find((x) => x.seat === seat);
    if (!p) break;
    // 随机策略：25% 弃牌 / 其余跟注或过牌 / 15% 加注
    const roll = Math.random();
    try {
      if (roll < 0.25) game.act(p.id, { type: 'fold' });
      else if (roll < 0.85) {
        if (p.betRound >= game.currentBet) game.act(p.id, { type: 'check' });
        else game.act(p.id, { type: 'call' });
      } else {
        const to = Math.min(
          game.currentBet + game.lastRaiseSize + Math.floor(Math.random() * 100),
          p.betRound + p.chips
        );
        const r = game.act(p.id, { type: 'raise', amount: to });
        if (!r.ok) game.act(p.id, { type: 'call' });
      }
    } catch (e) {
      throw new Error(`随机对战异常: ${e.message}`);
    }
  }
  const total = game.players.reduce((s, p) => s + p.chips, 0);
  const outChips = game.players.filter((p) => p.out).reduce((s, p) => s + p.chips, 0);
  assert.strictEqual(total + outChips, 2500, `总筹码应为 2500，实际 ${total}+${outChips}`);
  assert.ok(game.handNo > 3, `应完成多局（实际 ${game.handNo} 局）`);
});

test('前两家弃牌后立即结算，不再发公共牌', () => {
  const { game } = mockRoom(
    { initialChips: 100, sb: 10, bb: 20, maxPlayers: 3 },
    [{ name: 'A', chips: 100 }, { name: 'B', chips: 100 }, { name: 'C', chips: 100 }]
  );
  game.startHand();
  assert.strictEqual(game.handPlayers.length, 3);
  // 前两个行动者弃牌 → 剩一人直接收池
  const p1 = game.handPlayers.find((x) => x.seat === game.toActSeat);
  game.act(p1.id, { type: 'fold' });
  const p2 = game.handPlayers.find((x) => x.seat === game.toActSeat);
  game.act(p2.id, { type: 'fold' });
  assert.strictEqual(game.phase, 'handEnd');
  assert.strictEqual(game.result.type, 'fold-win');
  assert.strictEqual(game.board.length, 0, '不应再发公共牌');
  const winner = game.players.find((p) => p.name === game.result.winners[0].name);
  assert.strictEqual(
    winner.chips,
    100 - winner.totalCommitted + game.result.winners[0].amount,
    '赢家净筹码 = 初始 - 投入 + 赢额'
  );
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
