// 补丁：战绩改为出局顺序积分制（第1出局+1、第2出局+2...冠军=人数分）
const fs = require('fs');
const P = '/Users/maozi/maozi-cloud/maozi-poker-strat';

// ═══ 1) game.js ═══
const g = P + '/src/game.js';
let s = fs.readFileSync(g, 'utf8');

// 构造器加 exitOrder
s = s.replace(
  "    this.runoutEquities = null; // 跑牌期各座位胜率（%）",
  "    this.runoutEquities = null; // 跑牌期各座位胜率（%）\n    this.exitOrder = []; // 本场出局顺序（seat 数组，用于积分）"
);

// scheduleNext 标记 out 时记录顺序
const old1 = `    for (const p of this.handPlayers) {
      if (p.chips === 0 && !p.out) {
        p.out = true;
        this.log(\`\${p.name} 筹码耗尽，出局\`);
      }
    }`;
const new1 = `    for (const p of this.handPlayers) {
      if (p.chips === 0 && !p.out) {
        p.out = true;
        this.exitOrder.push(p.seat);
        this.log(\`\${p.name} 筹码耗尽，出局\`);
      }
    }`;
if (!s.includes(old1)) throw new Error('scheduleNext anchor');
s = s.replace(old1, new1);

// startHand / reset / forceEnd / returnToLobby 重置 exitOrder（跟 runoutReveal=false 同行区域）
s = s.split('    this.runoutReveal = false;').join('    this.runoutReveal = false;\n    this.exitOrder = [];');

// 去掉构造器多余行（第一处替换会多加一条——构造器已有 exitOrder 定义不需要再加）
// 检查是否有多余：startHand/reset/forceEnd/returnToLobby 共 4 处 + 构造器 1 处 = 5 处
const count = (s.match(/this\.exitOrder = \[\];/g) || []).length;
if (count > 5) {
  // 构造器附近第一条 exitOrder 声明是定义，后面4个是重置；移除构造器重置区域多余的一条
  // 实际上构造器定义 `this.exitOrder = [];` 后紧跟 `this._timers`；后面4个重置都在方法里
  // 拆开检查:定义 + 4 重置 = 5 是正确的
}

// endGame 改为传 exitOrder 给 recordChampion
const old2 = `    this.log(\`🏆 \${champ ? champ.name : '无人'} 赢得全场！\`);
    this.room.recordChampion(champ ? champ.id : null);`;
const new2 = `    this.log(\`🏆 \${champ ? champ.name : '无人'} 赢得全场！\`);
    this.room.recordExitScores(this.exitOrder, champ ? champ.seat : null);`;
if (!s.includes(old2)) throw new Error('endGame anchor');
s = s.replace(old2, new2);

// viewFor 不再发 wins/losses——roomState 已有 stats；Game 层面不需要改 viewFor（stats 在 roomState）
fs.writeFileSync(g, s);
console.log('game.js ✓  exitOrder 引用: ' + (s.match(/exitOrder/g) || []).length);

// ═══ 2) room.js ═══
const r = P + '/src/room.js';
let rs = fs.readFileSync(r, 'utf8');

// 替换 recordChampion 为 recordExitScores
const old3 = `  /** 终局记录战绩：冠军 +1 胜，房间内其他人各 +1 败 */
  recordChampion(champId) {
    for (const p of this.players) {
      const st = this.stats.get(p.id) || { name: p.name, wins: 0, losses: 0 };
      st.name = p.name; // 改名同步
      if (p.id === champId) st.wins += 1;
      else st.losses += 1;
      this.stats.set(p.id, st);
    }
  }`;
const new3 = `  /** 终局按出局顺序积分：第1出局+1、第2出局+2...冠军=总人数分 */
  recordExitScores(exitOrder, champSeat) {
    // 参与本场的座位 = exitOrder + 冠军
    const totalPlayers = exitOrder.length + (champSeat != null ? 1 : 0);
    const scoreOf = new Map(); // seat -> 本场得分
    exitOrder.forEach((seat, idx) => scoreOf.set(seat, idx + 1));
    if (champSeat != null) scoreOf.set(champSeat, totalPlayers);

    for (const p of this.players) {
      const earned = scoreOf.get(p.seat) || 0;
      if (earned === 0) continue; // 中途离开未参与终局的
      const st = this.stats.get(p.id) || { name: p.name, score: 0, games: 0 };
      st.name = p.name;
      st.score = (st.score || 0) + earned;
      st.games = (st.games || 0) + 1;
      this.stats.set(p.id, st);
    }
  }`;
if (!rs.includes(old3)) throw new Error('recordChampion anchor');
rs = rs.replace(old3, new3);

// roomState stats 排序改为按 score
rs = rs.replace(
  "stats: [...this.stats.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses),",
  "stats: [...this.stats.values()].sort((a, b) => b.score - a.score),"
);

fs.writeFileSync(r, rs);
console.log('room.js ✓');

// ═══ 3) lobby.js 前端 ═══
const l = P + '/public/js/lobby.js';
let ls = fs.readFileSync(l, 'utf8');

// 排序逻辑：按 score 降序
const old4 = `    const net = (pl) => {
      const st = stats.find((t) => t.name === pl.name);
      return st ? st.wins - st.losses : 0;
    };
    for (const p of [...room.players].sort((a, b) => net(b) - net(a) || a.seat - b.seat)) {`;
const new4 = `    const score = (pl) => {
      const st = stats.find((t) => t.name === pl.name);
      return st ? st.score || 0 : 0;
    };
    for (const p of [...room.players].sort((a, b) => score(b) - score(a) || a.seat - b.seat)) {`;
if (!ls.includes(old4)) throw new Error('lobby sort anchor');
ls = ls.replace(old4, new4);

// 徽章显示改为积分
const old5 = `      const myStat = (room.stats || []).find((t) => t.name === p.name);
      const stTxt = myStat
        ? \`<span class="pl-record"><span class="rec rec-win\${myStat.wins > 0 ? ' lit' : ''}">🏆 \${myStat.wins}</span><span class="rec rec-loss">✗ \${myStat.losses}</span></span>\`
        : '';`;
const new5 = `      const myStat = (room.stats || []).find((t) => t.name === p.name);
      const stTxt = myStat
        ? \`<span class="pl-record"><span class="rec rec-win\${(myStat.score || 0) > 0 ? ' lit' : ''}">⭐ \${myStat.score || 0}</span><span class="rec rec-loss">\${myStat.games || 0}场</span></span>\`
        : '';`;
if (!ls.includes(old5)) throw new Error('lobby badge anchor');
ls = ls.replace(old5, new5);

fs.writeFileSync(l, ls);
console.log('lobby.js ✓');

// ═══ 4) 语法 + 测试 ═══
const { execFileSync } = require('child_process');
for (const f of ['src/game.js', 'src/room.js', 'public/js/lobby.js']) {
  execFileSync('node', ['--check', f], { cwd: P, stdio: 'pipe' });
}
console.log('语法 OK');
const out = execFileSync('node', ['test/logic.test.js'], { cwd: P, encoding: 'utf8' });
console.log(out.split('\n').filter(l => l.includes('结果'))[0]);
