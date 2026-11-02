const fs = require('fs');
const P = '/Users/maozi/maozi-cloud/maozi-poker-strat';

const r = P + '/src/room.js';
let rs = fs.readFileSync(r, 'utf8');

// 替换整个 recordExitScores 函数体（用简单字符串定位）
const start = rs.indexOf('recordExitScores(exitOrder, champSeat) {');
const end = rs.indexOf('\n  }', start) + 4;
if (start < 0) throw new Error('function not found');
const oldFn = rs.slice(start, end);
const newFn = `recordExitScores(exitOrder, champSeat, exitRounds) {
    const totalPlayers = exitOrder.length + (champSeat != null ? 1 : 0);
    // 同轮/同筹码并列 → 取该组最小顺序位的积分
    const scoreOf = new Map();
    if (exitRounds && exitRounds.size > 0) {
      const roundMinIdx = new Map();
      exitOrder.forEach((seat, idx) => {
        const rd = exitRounds.get(seat);
        if (rd != null && !roundMinIdx.has(rd)) roundMinIdx.set(rd, idx);
      });
      exitOrder.forEach((seat, idx) => {
        const rd = exitRounds.get(seat);
        scoreOf.set(seat, (rd != null ? roundMinIdx.get(rd) : idx) + 1);
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
rs = rs.replace(oldFn, newFn);

// endGame 调用传 exitRounds
rs = rs.replace(
  'this.room.recordExitScores(this.exitOrder, champ ? champ.seat : null);',
  'this.room.recordExitScores(this.exitOrder, champ ? champ.seat : null, this.exitRound);'
);

// forceEnd score 分支加 exitRounds
const feStart = rs.indexOf("const ranked = room.players.filter((q) => total(q) > 0)");
const feEnd = rs.indexOf('room.recordExitScores', feStart);
if (feStart < 0 || feEnd < 0) throw new Error('forceEnd score block not found');
const oldBlock = rs.slice(feStart, feEnd);
const newBlock = `const ranked = room.players.filter((q) => total(q) > 0).sort((a, b) => total(b) - total(a));
      const exitOrder = ranked.slice(1).map((q) => q.seat);
      const champSeat = ranked.length > 0 ? ranked[0].seat : null;
      // 同筹码并列归同轮，积分取最小
      const exitRounds = new Map();
      let round = 0; let prevT = null;
      for (const q of ranked.slice(1)) {
        const t = total(q);
        if (prevT === null || t < prevT) round++;
        exitRounds.set(q.seat, round);
        prevT = t;
      }
      `;
rs = rs.replace(oldBlock, newBlock);
rs = rs.replace('room.recordExitScores(exitOrder, champSeat);', 'room.recordExitScores(exitOrder, champSeat, exitRounds);');

fs.writeFileSync(r, rs);
console.log('room.js ✓');

const { execFileSync } = require('child_process');
execFileSync('node', ['--check', 'src/room.js'], { cwd: P, stdio: 'pipe' });
console.log('语法 OK');
const out = execFileSync('node', ['test/logic.test.js'], { cwd: P, encoding: 'utf8' });
console.log(out.split('\n').filter(l => l.includes('结果'))[0]);
