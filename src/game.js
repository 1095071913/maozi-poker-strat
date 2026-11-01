/**
 * 德州扑克牌局引擎（No-Limit Texas Hold'em）
 * 服务端持有全部状态，客户端只发送动作、接收各自视角。
 *
 * 核心机制：
 * - 按钮位轮转、小盲/大盲（heads-up 时按钮=小盲）
 * - needToAct 集合驱动下注轮：加注后重开其他玩家行动权，
 *   翻牌前大盲保留选择权（无人加注时可过牌/再加注）
 * - 边池：按总投入分层构建，未弃牌且投入达标者有资格争夺
 * - 超时自动过牌/弃牌；离线玩家不参与发牌
 */
const { newDeck, cardText } = require('./cards');
const { evaluate7, cmpScore, highlightOf } = require('./evaluator');


class Game {
  constructor(room, settings) {
    this.room = room;
    this.sb = settings.sb;
    this.bb = settings.bb;
    this.players = room.players; // 与 Room 共享的玩家数组
    this.phase = 'waiting'; // waiting | playing | handEnd | gameOver
    this.handNo = 0;
    this.board = [];
    this.deck = [];
    this.buttonSeat = null;
    this.sbSeat = null;
    this.bbSeat = null;
    this.handPlayers = []; // 参与本局的玩家（按座位排序）
    this.street = 'preflop';
    this.currentBet = 0;
    this.lastRaiseSize = this.bb;
    this.needToAct = new Set();
    this.toActSeat = null;
    this.logs = [];
    this.result = null;
    this.readySet = new Set(); // 下一局已准备的座位
    this.lastEvals = null; // 摊牌时各座位牌型评估（含 best5，用于高亮）
    this.shownCards = new Set(); // 局末主动亮牌的座位（任何本局玩家）
    this.champion = null; // 全场冠军（gameOver 时）
    this.runoutReveal = false;
    this.runoutEquities = null; // 全下跑牌期提前亮牌
    this.runoutEquities = null; // 跑牌期各座位胜率（%）
    this._timers = [];
  }

  // ---------- 工具 ----------

  log(msg) {
    this.logs.push(msg);
    if (this.logs.length > 60) this.logs.shift();
  }

  setTimer(fn, ms) {
    const t = setTimeout(fn, ms);
    this._timers.push({ handle: t, fn });
    return t;
  }

  clearTimers() {
    for (const { handle } of this._timers) clearTimeout(handle);
    this._timers = [];
  }

  /** 测试辅助：同步执行所有待触发的定时器（如全下后逐街发牌） */
  flushTimers() {
    while (this._timers.length) {
      const item = this._timers.shift();
      clearTimeout(item.handle);
      item.fn();
    }
  }

  streetName() {
    return { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' }[this.street] || '';
  }

  potTotal() {
    return this.handPlayers.reduce((s, p) => s + p.totalCommitted, 0);
  }

  eligiblePlayers() {
    return this.players
      .filter((p) => p.online && !p.out && p.chips > 0)
      .sort((a, b) => a.seat - b.seat);
  }

  /** 玩家投入筹码 */
  post(p, pay) {
    pay = Math.min(pay, p.chips);
    p.chips -= pay;
    p.betRound += pay;
    p.totalCommitted += pay;
    if (p.chips === 0) p.allin = true;
    return pay;
  }

  // ---------- 开局 ----------

  startHand() {
    this.clearTimers();
    const eligible = this.eligiblePlayers();
    if (eligible.length < 2) return false;

    this.handPlayers = eligible;
    this.handNo++;
    this.phase = 'playing';
    this.readySet.clear();
    this.lastEvals = null;
    this.shownCards.clear();
    this.runoutReveal = false;
    this.runoutEquities = null;
    this.street = 'preflop';
    this.board = [];
    this.deck = newDeck();
    this.result = null;
    this.logs = [];

    for (const p of this.players) {
      p.inHand = eligible.includes(p);
      p.cards = [];
      p.betRound = 0;
      p.totalCommitted = 0;
      p.folded = false;
      p.allin = false;
      p.lastAction = null;
      p.winAmount = 0;
      p.handName = null;
      p.returned = 0;
      p.revealed = false;
    }

    // 按钮位轮转（首局随机）
    const seats = eligible.map((p) => p.seat);
    if (this.buttonSeat === null || !seats.includes(this.buttonSeat)) {
      this.buttonSeat = seats[Math.floor(Math.random() * seats.length)];
    } else {
      const i = seats.indexOf(this.buttonSeat);
      this.buttonSeat = seats[(i + 1) % seats.length];
    }

    const n = eligible.length;
    const bi = eligible.findIndex((p) => p.seat === this.buttonSeat);
    let sbIdx, bbIdx, utgIdx;
    if (n === 2) {
      sbIdx = bi; // heads-up: 按钮是小盲，且翻牌前先行动
      bbIdx = (bi + 1) % 2;
      utgIdx = bi;
    } else {
      sbIdx = (bi + 1) % n;
      bbIdx = (bi + 2) % n;
      utgIdx = (bi + 3) % n;
    }
    this.sbSeat = eligible[sbIdx].seat;
    this.bbSeat = eligible[bbIdx].seat;
    this.post(eligible[sbIdx], this.sb);
    this.post(eligible[bbIdx], this.bb);

    // 发底牌，每人两张
    for (let round = 0; round < 2; round++) {
      for (const p of eligible) p.cards.push(this.deck.pop());
    }

    this.currentBet = Math.max(...eligible.map((p) => p.betRound));
    this.lastRaiseSize = this.bb;
    this.needToAct = new Set(eligible.filter((p) => !p.allin).map((p) => p.seat));
    this.toActIdx = utgIdx;

    this.log(`—— 第 ${this.handNo} 局 · 盲注 ${this.sb}/${this.bb} ——`);
    this.room.broadcastRoom();
    this.beginTurn();
    return true;
  }

  // ---------- 行动轮 ----------

  beginTurn() {
    if (this.phase !== 'playing') return;
    if (this.needToAct.size === 0) {
      this.endStreet();
      return;
    }
    const n = this.handPlayers.length;
    for (let i = 0; i < n; i++) {
      const p = this.handPlayers[(this.toActIdx + i) % n];
      if (this.needToAct.has(p.seat)) {
        this.toActSeat = p.seat;
        // 已取消行动限时：不限时等待玩家操作（掉线时由 markOffline 触发自动行动）
        this.room.broadcastGame();
        return;
      }
    }
    this.endStreet();
  }

  /** 外部入口：玩家行动 */
  act(playerId, { type, amount }) {
    if (this.phase !== 'playing') return { ok: false, error: '当前不在牌局中' };
    const p = this.players.find((q) => q.id === playerId);
    if (!p || p.seat !== this.toActSeat) return { ok: false, error: '还没轮到你行动' };
    if (p.folded || !p.inHand) return { ok: false, error: '你已弃牌' };
    if (p.allin) return { ok: false, error: '你已全下' };
    if (!['fold', 'check', 'call', 'raise'].includes(type)) {
      return { ok: false, error: '未知操作' };
    }
    if (type === 'check' && p.betRound < this.currentBet) {
      return { ok: false, error: '有人下注，不能过牌' };
    }
    if (type === 'raise') {
      const maxTo = p.betRound + p.chips;
      let to = Math.floor(Number(amount) || 0);
      if (to <= this.currentBet) return { ok: false, error: '加注金额需大于当前注额' };
      const isAllin = to >= maxTo;
      if (to > maxTo) to = maxTo;
      if (!isAllin && to < this.currentBet + this.lastRaiseSize) {
        return { ok: false, error: `最小加注到 ${this.currentBet + this.lastRaiseSize}` };
      }
    }
    this.applyAction(p, type, amount);
    return { ok: true };
  }

  /** 内部：应用已验证的动作 */
  applyAction(p, type, rawAmount) {
    const prevBet = this.currentBet;

    if (type === 'fold') {
      p.folded = true;
      p.lastAction = { type: 'fold', street: this.street };
      this.needToAct.delete(p.seat);
      this.log(`${p.name} 弃牌`);
    } else if (type === 'check') {
      p.lastAction = { type: 'check', street: this.street };
      this.needToAct.delete(p.seat);
      this.log(`${p.name} 过牌`);
    } else if (type === 'call') {
      const need = this.currentBet - p.betRound;
      const short = need > p.chips;
      this.post(p, need);
      p.lastAction = { type: p.allin ? 'allin' : 'call', amount: p.betRound, street: this.street };
      this.needToAct.delete(p.seat);
      this.log(short ? `${p.name} 全下跟注 ${p.betRound}` : `${p.name} 跟注到 ${p.betRound}`);
    } else if (type === 'raise') {
      const maxTo = p.betRound + p.chips;
      let to = Math.min(Math.floor(rawAmount || 0), maxTo);
      const isAllin = to === maxTo;
      this.post(p, to - p.betRound);
      if (p.betRound > prevBet) {
        this.lastRaiseSize = Math.max(this.lastRaiseSize, p.betRound - prevBet);
        this.currentBet = p.betRound;
        // 加注重开其他玩家的行动权
        this.needToAct = new Set(
          this.handPlayers.filter((q) => !q.folded && !q.allin && q.seat !== p.seat).map((q) => q.seat)
        );
      }
      this.needToAct.delete(p.seat);
      p.lastAction = { type: isAllin ? 'allin' : 'raise', amount: p.betRound, street: this.street };
      this.log(isAllin ? `${p.name} 全下 ${p.betRound}！` : `${p.name} 加注到 ${p.betRound}`);
    }

    const inHand = this.handPlayers.filter((q) => !q.folded);
    if (inHand.length === 1) {
      this.room.broadcastGame();
      return this.finishHand(inHand[0]);
    }
    this.toActIdx = this.handPlayers.indexOf(p) + 1;
    this.beginTurn();
  }

  /** 一条街结束：收注入池、发下一街或摊牌 */
  endStreet() {
    if (this.phase !== 'playing') return;
    for (const p of this.handPlayers) p.betRound = 0;
    this.currentBet = 0;
    this.lastRaiseSize = this.bb;

    const inHand = this.handPlayers.filter((p) => !p.folded);
    if (inHand.length === 1) return this.finishHand(inHand[0]);
    if (this.street === 'river') return this.showdown();

    const active = inHand.filter((p) => !p.allin);
    if (active.length <= 1) return this.runOut(); // 无需再下注，发完公共牌摊牌

    this.dealStreet();
    // 翻牌后从按钮下一位开始（heads-up 从大盲位开始）
    const n = this.handPlayers.length;
    const startSeat = n === 2 ? this.bbSeat : this.sbSeat;
    this.toActIdx = this.handPlayers.findIndex((p) => p.seat === startSeat);
    this.needToAct = new Set(active.map((p) => p.seat));
    this.beginTurn();
  }

  dealStreet() {
    this.deck.pop(); // 烧牌
    const names = { flop: '翻牌', turn: '转牌', river: '河牌' };
    const next = { preflop: 'flop', flop: 'turn', turn: 'river' }[this.street];
    const count = next === 'flop' ? 3 : 1;
    const cards = [];
    for (let i = 0; i < count; i++) cards.push(this.deck.pop());
    this.board.push(...cards);
    this.street = next;
    this.log(`${names[next]}：${cards.map(cardText).join(' ')}`);
  }

  /** 逐街发完剩余公共牌（全员全下等情况），然后摊牌 */
  runOut() {
    // 无需再行动：清空行动位，防止任何玩家在此期间行动
    this.toActSeat = null;
    // 摊牌前置：先亮出全下玩家的底牌，再慢慢翻公共牌（电视转播式悬念）
    this.runoutReveal = true;
    for (const p of this.handPlayers.filter((q) => !q.folded)) {
      if (!p.revealed) {
        p.revealed = true;
        this.log(`${p.name} 摊牌 ${p.cards.map(cardText).join(' ')}`);
      }
    }
    this.calcEquities();
    this.room.broadcastGame();
    const step = () => {
      if (this.phase !== 'playing') return;
      if (this.board.length >= 5) return this.showdown();
      this.setTimer(step, 1400);
      this.dealStreet();
      this.calcEquities();
      this.room.broadcastGame();
    };
    this.setTimer(step, 1200);
  }

  /** 全下跑牌期：计算各亮牌玩家当前胜率（%） */
  calcEquities() {
    const players = this.handPlayers.filter((p) => !p.folded && p.cards.length === 2);
    if (players.length < 2 || this.board.length >= 5) {
      this.runoutEquities = null;
      return;
    }
    const dead = new Set();
    for (const p of players) for (const c of p.cards) dead.add(c.rank + c.suit);
    for (const c of this.board) dead.add(c.rank + c.suit);
    const deck = [];
    for (const su of ['s', 'h', 'd', 'c'])
      for (let r = 2; r <= 14; r++) if (!dead.has(r + su)) deck.push({ rank: r, suit: su });
    const need = 5 - this.board.length;
    const wins = new Array(players.length).fill(0);
    let trials = 0;

    const runBoard = (extra) => {
      trials++;
      const full = [...this.board, ...extra];
      let best = null;
      let leaders = [];
      players.forEach((p, idx) => {
        const sc = evaluate7([...p.cards, ...full]).score;
        if (!best || cmpScore(sc, best) > 0) { best = sc; leaders = [idx]; }
        else if (cmpScore(sc, best) === 0) leaders.push(idx);
      });
      for (const idx of leaders) wins[idx] += 1 / leaders.length;
    };

    if (need === 1) {
      for (const c of deck) runBoard([c]); // 46 种，精确
    } else if (need === 2) {
      for (let i = 0; i < deck.length; i++)
        for (let j = i + 1; j < deck.length; j++) runBoard([deck[i], deck[j]]); // ~1089 种，精确
    } else {
      for (let t = 0; t < 1500; t++) { // preflop 全下：蒙特卡洛
        const pool = deck.slice();
        const extra = [];
        while (extra.length < need) extra.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        runBoard(extra);
      }
    }
    this.runoutEquities = new Map(players.map((p, i) => [p.seat, Math.round((wins[i] / trials) * 100)]));
  }

  // ---------- 结算 ----------

  /** 按总投入分层构建主池与边池 */
  buildPots() {
    const commits = this.handPlayers.map((p) => p.totalCommitted).filter((c) => c > 0);
    const levels = [...new Set(commits)].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of this.handPlayers) {
        amount += Math.max(0, Math.min(p.totalCommitted, level) - Math.min(p.totalCommitted, prev));
      }
      let eligible = this.handPlayers.filter((p) => !p.folded && p.totalCommitted >= level);
      if (eligible.length === 0) {
        // 理论上不发生：无人有资格的层并入上一池
        if (pots.length) pots[pots.length - 1].amount += amount;
        continue;
      }
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    return pots;
  }

  /** 摊牌 */
  showdown() {
    this.clearTimers();
    this.phase = 'handEnd';
    this.runoutEquities = null;
    const inHand = this.handPlayers.filter((p) => !p.folded);
    const evals = new Map();
    for (const p of inHand) {
      const ev = evaluate7([...p.cards, ...this.board]);
      evals.set(p.seat, ev);
      p.handName = ev.name;
      if (!p.revealed) {
        p.revealed = true;
        this.log(`${p.name} 亮牌 ${p.cards.map(cardText).join(' ')}（${ev.name}）`);
      }
    }
    this.lastEvals = evals; // 供 viewFor 生成摊牌高亮
    for (const pot of this.buildPots()) {
      // 单人层 = 未被跟注的下注退回，不是竞争胜利：不计胜者、不亮胜者标记
      if (pot.eligible.length === 1) {
        const w = pot.eligible[0];
        w.chips += pot.amount;
        w.returned = (w.returned || 0) + pot.amount;
        this.log(`${w.name} 收回未被跟注的 ${pot.amount}`);
        continue;
      }
      let best = null;
      let winners = [];
      for (const p of pot.eligible) {
        const score = evals.get(p.seat).score;
        if (!best || cmpScore(score, best) > 0) {
          best = score;
          winners = [p];
        } else if (cmpScore(score, best) === 0) {
          winners.push(p);
        }
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const w of winners) {
        let win = share;
        if (remainder > 0) {
          win += 1; // 平分余数依次给赢家
          remainder -= 1;
        }
        w.chips += win;
        w.winAmount += win;
      }
      this.log(
        `${winners.map((w) => w.name).join('、')} 以 ${evals.get(winners[0].seat).name} 赢得 ${pot.amount} 底池`
      );
    }
    const winners = inHand.filter((p) => p.winAmount > 0);
    this.result = {
      type: 'showdown',
      winners: winners.map((p) => ({ seat: p.seat, name: p.name, amount: p.winAmount })),
    };
    this.room.broadcastGame();
    this.scheduleNext();
  }

  /** 其余玩家全部弃牌，直接收池（不亮牌） */
  finishHand(winner) {
    this.clearTimers();
    this.phase = 'handEnd';
    const total = this.potTotal();
    winner.chips += total;
    winner.winAmount = total;
    this.result = {
      type: 'fold-win',
      winners: [{ seat: winner.seat, name: winner.name, amount: total }],
    };
    this.log(`${winner.name} 收下 ${total} 底池（其余玩家弃牌）`);
    this.room.broadcastGame();
    this.scheduleNext();
  }

  /** 下一局：等待全员准备；仅筹码淘汰至不足两人才终局（离线者保留资格） */
  scheduleNext() {
    for (const p of this.handPlayers) {
      if (p.chips === 0 && !p.out) {
        p.out = true;
        this.log(`${p.name} 筹码耗尽，出局`);
      }
    }
    this.readySet.clear();
    const alive = this.players.filter((p) => !p.out && p.chips > 0);
    if (alive.length < 2) {
      this.setTimer(() => this.endGame(), 1500);
      return;
    }
    this.log('全员准备后开始下一局');
    this.room.broadcastGame();
  }

  /** 玩家点击准备下一局（局间全员准备，含房主） */
  ready(playerId) {
    if (this.phase !== 'handEnd') return { ok: false, error: '当前不在等待准备阶段' };
    const p = this.players.find((q) => q.id === playerId);
    if (!p || !p.online || p.out || p.chips <= 0) {
      return { ok: false, error: '你无需准备，等待开局即可' };
    }
    if (this.readySet.has(p.seat)) return { ok: true };
    this.readySet.add(p.seat);
    this.log(`${p.name} 已准备`);
    this.checkAutoStart();
    if (this.phase === 'handEnd') this.room.broadcastGame();
    return { ok: true };
  }

  /** 局间需要准备的玩家：所有能参与下一局的人（含房主、含离线者——须等其回归准备） */
  readyNeeded() {
    return this.players.filter((p) => !p.out && p.chips > 0);
  }

  /** 局末任何本局玩家可主动亮牌给所有人看（一次性） */
  showCards(playerId) {
    if (this.phase !== 'handEnd') return { ok: false, error: '当前不能亮牌' };
    const p = this.players.find((q) => q.id === playerId);
    if (!p || !p.inHand || !p.cards || !p.cards.length) {
      return { ok: false, error: '你没有参与本局' };
    }
    if (this.shownCards.has(p.seat)) return { ok: true };
    this.shownCards.add(p.seat);
    this.log(`${p.name} 亮牌 ${p.cards.map(cardText).join(' ')}`);
    this.room.broadcastGame();
    return { ok: true };
  }

  /** 检查是否已全员准备（准备/上下线时调用） */
  checkAutoStart() {
    if (this.phase !== 'handEnd') return;
    const eligible = this.eligiblePlayers();
    // 在线不足两人：等待离线者回归，不终局（终局只由筹码淘汰触发，见 scheduleNext）
    if (eligible.length < 2) return;
    if (this.readyNeeded().every((p) => this.readySet.has(p.seat))) {
      this.log('全员已准备，开始下一局');
      this.startHand();
    }
  }

  /** 终局后返回房间大厅（任何人可触发），保留各人当前筹码；房主再开始时自动重置 */
  returnToLobby() {
    this.clearTimers();
    this.phase = 'waiting';
    this.result = null;
    this.handPlayers = [];
    this.board = [];
    this.logs = [];
    this.buttonSeat = null;
    this.readySet.clear();
    this.lastEvals = null;
    this.shownCards.clear();
    this.runoutReveal = false;
    this.runoutEquities = null;
    this.champion = null;
    for (const p of this.players) {
      p.inHand = false;
      p.cards = [];
      p.betRound = 0;
      p.totalCommitted = 0;
      p.folded = false;
      p.allin = false;
      p.lastAction = null;
      p.revealed = false;
      p.handName = null;
      p.winAmount = 0;
      p.returned = 0;
    }
    this.log('牌局结束，回到房间大厅');
    this.room.broadcastRoom();
    this.room.broadcastGame();
  }

  /** 房主强制结束牌局：回房间大厅，保留各人当前筹码 */
  forceEnd() {
    this.clearTimers();
    this.phase = 'waiting';
    this.result = null;
    this.handPlayers = [];
    this.board = [];
    this.logs = [];
    this.buttonSeat = null;
    this.readySet.clear();
    this.lastEvals = null;
    this.shownCards.clear();
    this.runoutReveal = false;
    this.runoutEquities = null;
    this.champion = null;
    this.toActSeat = null;
    for (const p of this.players) {
      p.inHand = false;
      p.cards = [];
      p.betRound = 0;
      p.totalCommitted = 0;
      p.folded = false;
      p.allin = false;
      p.lastAction = null;
      p.revealed = false;
      p.handName = null;
      p.returned = 0;
      p.winAmount = 0;
    }
    this.log('房主结束了牌局，返回房间大厅');
    this.room.broadcastRoom();
    this.room.broadcastGame();
  }

  endGame() {
    this.clearTimers();
    this.phase = 'gameOver';
    const champ = this.players
      .filter((p) => !p.out)
      .sort((a, b) => b.chips - a.chips)[0];
    // 冠军单独存放；result 保留最后一局的摊牌信息，供终局复盘（看怎么赢的）
    this.champion = champ ? { seat: champ.seat, name: champ.name, chips: champ.chips } : null;
    this.log(`🏆 ${champ ? champ.name : '无人'} 赢得全场！`);
    this.room.recordChampion(champ ? champ.id : null);
    this.room.broadcastRoom();
    this.room.broadcastGame();
  }

  /** 房主重置：所有人恢复初始筹码 */
  reset() {
    this.clearTimers();
    this.phase = 'waiting';
    this.result = null;
    this.handPlayers = [];
    this.board = [];
    this.logs = [];
    this.buttonSeat = null;
    this.readySet.clear();
    this.lastEvals = null;
    this.shownCards.clear();
    this.runoutReveal = false;
    this.runoutEquities = null;
    this.champion = null;
    for (const p of this.players) {
      p.chips = this.room.settings.initialChips;
      p.out = false;
      p.inHand = false;
      p.cards = [];
      p.betRound = 0;
      p.totalCommitted = 0;
      p.folded = false;
      p.allin = false;
      p.lastAction = null;
      p.revealed = false;
    }
    this.room.broadcastRoom();
    this.room.broadcastGame();
  }

  // ---------- 视角 ----------

  /** 为指定玩家生成私有视角（自己的底牌只有自己可见） */
  viewFor(viewer) {
    // 摊牌亮牌在结算与终局（gameOver）期间都可见，便于复盘
    const isReveal =
      (this.phase === 'handEnd' || this.phase === 'gameOver') &&
      this.result &&
      this.result.type === 'showdown';
    // 下一个行动座位（顺时针跳过已行动者）
    let nextToActSeat = null;
    if (this.phase === 'playing' && this.toActSeat != null) {
      const n = this.handPlayers.length;
      const cur = this.handPlayers.findIndex((p) => p.seat === this.toActSeat);
      for (let i = 1; i <= n; i++) {
        const q = this.handPlayers[(cur + i) % n];
        if (this.needToAct.has(q.seat)) {
          nextToActSeat = q.seat;
          break;
        }
      }
    }

    // 胜者座位（用于组合高亮：只高亮胜者的组合）
    const winnerSeats = new Set(
      (this.result && this.result.winners ? this.result.winners : []).map((w) => w.seat)
    );

    const players = this.players.map((p) => {
      let ev = null;
      if (isReveal && p.revealed && this.lastEvals) {
        ev = this.lastEvals.get(p.seat);
      } else if (
        winnerSeats.has(p.seat) &&
        this.shownCards.has(p.seat) &&
        p.inHand &&
        p.cards.length
      ) {
        // 弃牌收池后胜者主动亮牌：也高亮其组合
        ev = evaluate7([...p.cards, ...this.board]);
      }
      if (ev && !winnerSeats.has(p.seat)) ev = null; // 败者不高亮
      const base = {
        seat: p.seat,
        name: p.name,
        chips: p.chips,
        betRound: this.phase === 'playing' ? p.betRound : 0,
        totalBet: p.inHand ? p.totalCommitted : 0, // 本局累计投入（跨街）
        returned: p.returned || 0, // 未被跟注退回的部分
        folded: !!p.folded,
        allin: !!p.allin,
        inHand: !!p.inHand,
        out: !!p.out,
        online: p.online,
        isOwner: p.isOwner,
        isButton: p.seat === this.buttonSeat && p.inHand,
        isSB: p.seat === this.sbSeat && p.inHand,
        isBB: p.seat === this.bbSeat && p.inHand,
        lastAction: p.lastAction,
        winAmount: p.winAmount || 0,
        handName: p.handName,
        isReady: this.phase === 'handEnd' && this.readySet.has(p.seat),
        isNext: this.phase === 'playing' && p.seat === nextToActSeat, // 下一个行动
        equity: this.runoutEquities ? this.runoutEquities.get(p.seat) ?? null : null, // 全下跑牌期胜率
        cardCount: p.inHand && !p.folded ? p.cards.length : 0,
        highlight: ev ? highlightOf(ev) : null, // 摊牌高亮：构成牌型的关键牌
        showedCards: this.shownCards.has(p.seat), // 局末主动亮牌（含弃牌者）
        cards: null,
      };
      if (viewer && p.id === viewer.id && p.cards.length) {
        base.cards = p.cards; // 自己的底牌
      } else if ((isReveal || this.runoutReveal) && p.revealed) {
        base.cards = p.cards; // 摊牌/全下跑牌期亮牌
      } else if (this.shownCards.has(p.seat) && p.inHand) {
        base.cards = p.cards; // 弃牌收池后赢家主动亮牌
      }
      return base;
    });

    let options = null;
    if (this.phase === 'playing' && viewer && viewer.seat === this.toActSeat) {
      const need = this.currentBet - viewer.betRound;
      const maxTo = viewer.betRound + viewer.chips;
      const minRaiseTo = Math.min(this.currentBet + this.lastRaiseSize, maxTo);
      options = {
        canCheck: need <= 0,
        callAmount: Math.max(0, Math.min(need, viewer.chips)),
        callIsAllin: need >= viewer.chips,
        canRaise: maxTo > this.currentBet,
        minRaiseTo,
        maxRaiseTo: maxTo,
        pot: this.potTotal(),
      };
    }

    let ready = null;
    if (this.phase === 'handEnd') {
      const need = this.readyNeeded();
      const readySeats = need.filter((p) => this.readySet.has(p.seat)).map((p) => p.seat);
      ready = {
        needed: need.length,
        readyCount: readySeats.length,
        readySeats,
        iAmReady: !!(viewer && this.readySet.has(viewer.seat)),
        iShouldReady: !!(viewer && viewer.online && !viewer.out && viewer.chips > 0),
        pendingNames: need.filter((p) => !this.readySet.has(p.seat)).map((p) => ({ name: p.name, online: p.online })),
      };
    }

    // 主胜者的关键牌（前端据此高亮公共牌）：摊牌取评估；弃牌收池且胜者亮牌则现算
    let winnerHighlight = null;
    const w0 = this.result && this.result.winners ? this.result.winners[0] : null;
    if (w0) {
      if (isReveal && this.lastEvals) {
        winnerHighlight = highlightOf(this.lastEvals.get(w0.seat)) || null;
      } else if (this.shownCards.has(w0.seat)) {
        const wp = this.players.find((q) => q.seat === w0.seat);
        if (wp && wp.inHand && wp.cards.length) {
          const ev = evaluate7([...wp.cards, ...this.board]);
          winnerHighlight = ev ? highlightOf(ev) : null;
        }
      }
    }

    return {
      phase: this.phase,
      handNo: this.handNo,
      street: this.street,
      streetName: this.streetName(),
      board: this.board,
      pot: this.potTotal(),
      sb: this.sb,
      bb: this.bb,
      toActSeat: this.phase === 'playing' ? this.toActSeat : null,
      nextToActSeat,
      players,
      mySeat: viewer ? viewer.seat : null,
      myCards: viewer && viewer.cards ? viewer.cards : null,
      options,
      ready,
      winnerHighlight,
      champion: this.phase === 'gameOver' ? this.champion : null,
      logs: this.logs.slice(-10),
      result: this.result,
    };
  }
}

module.exports = Game;
