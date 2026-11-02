// 补丁：同轮/同筹码并列时积分往下取（取最小出局顺序的分）
const fs = require('fs');
const P = '/Users/maozi/maozi-cloud/maozi-poker-strat';

// ═══ 1) game.js：scheduleNext 同轮多人出局，exitOrder 顺序保持但 recordExitScores 需识别同轮 ═══
const g = P + '/src/game.js';
let s = fs.readFileSync(g, 'utf8');
// 加 roundOfExit Map（seat -> 出局轮次），同轮出局的人积分相同
if (!s.includes('exitRound')) {
  s = s.replace(
    "    this.exitOrder = []; // 本场出局顺序（seat 数组，用于积分）",
    "    this.exitOrder = []; // 本场出局顺序（seat 数组，用于积分）\n    this.exitRound = new Map(); // seat -> 出局轮次（同轮出局积分相同，取最小分）"
  );
  // scheduleNext push 时记录轮次
  s = s.replace(
    "        p.out = true;\n        this.exitOrder.push(p.seat);",
    "        p.out = true;\n        this.exitOrder.push(p.seat);\n        this.exitRound.set(p.seat, this.handNo);"
  );
  // reset 各处清空（跟 exitOrder=[] 同行）
  s = s.split('    this.exitOrder = [];').join('    this.exitOrder = [];\n    this.exitRound.clear();');
}
fs.writeFileSync(g, s);
console.log('game.js ✓');

// ═══ 2) room.js：recordExitScores 改为支持同轮并列 + forceEnd score 同筹码并列 ═══
const r = P + '/src/room.js';
let rs = fs.readFileSync(r, 'utf8');

// 替换 recordExitScores
const old1 = `  /** 终局按出局顺序积分：第1出局+1、第2出局+2...冠军=总人数分 */
  recordExitScores(exitOrder, champSeat) {
    // 参与本场的座位 = exitOrder + 冠军
    const totalPlayers = exitOrder.length + (champSeat != null ? 1 : 0);
    const scoreOf = new Map(); // seat -> 本场得分
    exitOrder.forEach((seat, idx) => scoreOf.set(seat, idx + 1));
    if (champSeat != null) scoreOf.set(champSeat, totalPlayers);

    for (const p of this.players) {
      const earned = scoreOf.get(p.seat) || 0;
      if (earned === 0) continue;
      const st = this.stats.get(p.id) || { name: p.name, score: 0, games: 0 };
      st.name = p.name;
      st.score = (st.score || 0) + earned;
      st.games = (st.games || 0) + 1;
      this.stats.set(p.id, st);
    }
  }`;
const new1 = `  /**
   * 终局按出局顺序积分（同轮并列取最小分）：
   * exitRounds: Map<seat, 出局轮次>——同轮出局的玩家积分相同（取该轮最前的顺序位）
   * champSeat: 冠军座位（得总人数分）
   */
  recordExitScores(exitOrder, champSeat, exitRounds) {
    const totalPlayers = exitOrder.length + (champSeat != null ? 1 : 0);

    // 计算每个出局顺序位的积分（从1开始）；同轮并列的取该轮内最小顺序位
    const scoreOf = new Map();
    if (exitRounds && exitRounds.size > 0) {
      // 按 exitOrder 顺序遍历，同轮的人取第一个出现的顺序位
      const roundMinIdx = new Map(); // round -> 该轮最小 idx
      exitOrder.forEach((seat, idx) => {
        const round = exitRounds.get(seat);
        if (round != null && !roundMinIdx.has(round)) roundMinIdx.set(round, idx);
      });
      exitOrder.forEach((seat, idx) => {
        const round = exitRounds.get(seat);
        const minIdx = round != null ? roundMinIdx.get(round) : idx;
        scoreOf.set(seat, minIdx + 1);
      });
    } else {
      exitOrder.forEach((seat, idx) => scoreOf.set(seat, idx + 1));
    }
    if (champSeat != null) scoreOf.set(champSeat, totalPlayers);

    for (const p of this.players) {
      const earned = scoreOf.get(p.seat) || 0;
      if (earned === 0) continue;
      const st = this.stats.get(p.id) || { name: p.name, score: 0, games: 0 };
      st.name = p.name;
      st.score = (st.score || 0) + earned;
      st.games = (st.games || 0) + 1;
      this.stats.set(p.id, st);
    }
  }`;
if (!rs.includes(old1)) throw new Error('recordExitScores anchor');
rs = rs.replace(old1, new1);

// endGame 调用传 exitRounds
const old2 = "this.room.recordExitScores(this.exitOrder, champ ? champ.seat : null);";
const nw2 = "this.room.recordExitScores(this.exitOrder, champ ? champ.seat : null, this.exitRound);";
if (!rs.includes(old2)) throw new Error('endGame call anchor');
rs = rs.replace(old2, nw2);

// forceEnd score 分支：同筹码并列也往下取
const old3 = `      // 按总筹码排名（当前筹码 + 本局已投入底池的筹码）：最高者视为冠军
      const total = (q) => q.chips + (q.totalCommitted || 0);
      const ranked = room.players.filter((q) => total(q) > 0).sort((a, b) => total(b) - total(a));
      const exitOrder = ranked.slice(1).map((q) => q.seat); // 冠军以外按筹码降序
      const champSeat = ranked.length > 0 ? ranked[0].seat : null;
      room.recordExitScores(exitOrder, champSeat);`;
const nw3 = `      // 按总筹码排名（当前筹码 + 本局已投入底池的筹码）：最高者视为冠军
      // 同筹码并列 → 积分往下取（取并列组的最小顺序位）
      const total = (q) => q.chips + (q.totalCommitted || 0);
      const ranked = room.players.filter((q) => total(q) > 0).sort((a, b) => total(b) - total(a));
      const exitOrder = ranked.slice(1).map((q) => q.seat);
      const champSeat = ranked.length > 0 ? ranked[0].seat : null;
      // 构造 exitRounds：同筹码的归为同一"轮次"
      const exitRounds = new Map();
      let round = 0;
      let prevTotal = null;
      for (const q of ranked.slice(1)) {
        const t = total(q);
        if (prevTotal === null || t < prevTotal) round++;
        exitRounds.set(q.seat, round);
        prevTotal = t;
      }
      room.recordExitScores(exitOrder, champSeat, exitRounds);`;
if (!rs.includes(old3)) throw new Error('forceEnd score anchor');
rs = rs.replace(old3, nw3);

fs.writeFileSync(r, rs);
console.log('room.js ✓');

// ═══ 3) 语法 + 测试 ═══
const { execFileSync } = require('child_process');
for (const f of ['src/game.js', 'src/room.js']) {
  execFileSync('node', ['--check', f], { cwd: P, stdio: 'pipe' });
}
console.log('语法 OK');
const out = execFileSync('node', ['test/logic.test.js'], { cwd: P, encoding: 'utf8' });
console.log(out.split('\n').filter(l => l.includes('结果'))[0]);
