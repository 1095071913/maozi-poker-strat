/** 牌桌视图：座位环绕布局 / 公共牌 / 手牌 / 操作栏 / 摊牌结算（精致视觉版） */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_NAME = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  const cardText = (c) => (RANK_NAME[c.rank] || c.rank) + SUIT_SYM[c.suit];
  const isRed = (c) => c.suit === 'h' || c.suit === 'd';
  const hueOf = (seat) => `hue-${((seat % 8) + 8) % 8}`;

  /** 待准备名单：离线者标注（等待其回归） */
  function fmtPending(list) {
    return (list || []).map((x) => Lobby.escapeHtml(x.name) + (x.online ? '' : '（离线）')).join('、') || '—';
  }

  /** 摊牌高亮集合：key = 牌面文本 */
  const hlSetOf = (cards) => (cards && cards.length ? new Set(cards.map(cardText)) : null);
  /** withDim：摊牌时压暗无关牌；进行中只亮组合不压暗（避免误导公共牌阅读） */
  const hlClass = (card, set, withDim = true) => {
    if (!set) return '';
    return set.has(cardText(card)) ? ' hl' : withDim ? ' dim' : '';
  };

  /** 游戏进行中：实时计算"我的手牌+公共牌"最强组合（一对及以上才高亮）
   *  翻牌前支持口袋对子；翻牌后枚举全部 5 张组合取最高分 */
  function liveCombo(game) {
    if (game.phase !== 'playing') return null;
    const my = game.myCards;
    if (!my || my.length < 2) return null;
    if (game.board.length < 3) {
      // 翻牌前：手牌自成对子
      if (my[0].rank === my[1].rank) {
        return { cards: my.slice(), set: new Set(my.map(cardText)), name: '一对' };
      }
      return null;
    }
    const ev = window.Evaluator && Evaluator.evaluate7([...my, ...game.board]);
    if (!ev) return null;
    const cards = Evaluator.highlightOf(ev); // 组合牌；高牌时为最大 1 张
    // 高亮集合：有组合才高亮（高牌不高亮牌面，只在展示区显示最强单张）
    const set = ev.category >= 1 ? new Set(cards.map(cardText)) : null;
    return { cards, set, name: ev.name };
  }

  /** 组合展示行的迷你牌 HTML */
  function comboMiniHTML(c) {
    const r = RANK_NAME[c.rank] || c.rank;
    const s = SUIT_SYM[c.suit];
    return `<span class="pcard pcard-mini mc-card ${isRed(c) ? 'red' : 'black'}"><span class="pc-rank">${r}</span><span class="pc-suit">${s}</span></span>`;
  }

  /** 生成一张牌面 DOM（四角点数 + 中心花色；hlSet 用于摊牌组合高亮） */
  function cardEl(card, size, hlSet, withDim = true) {
    const el = document.createElement('span');
    if (!card) {
      el.className = `pcard ${size} empty`;
      return el;
    }
    const r = RANK_NAME[card.rank] || card.rank;
    const s = SUIT_SYM[card.suit];
    el.className = `pcard ${size} ${isRed(card) ? 'red' : 'black'}${hlClass(card, hlSet, withDim)}`;
    if (size === 'pcard-mini') {
      el.innerHTML = `<span class="pc-rank">${r}</span><span class="pc-suit">${s}</span>`;
    } else {
      el.innerHTML = `
        <span class="pc-corner">${r}<i>${s}</i></span>
        <span class="pc-center">${s}</span>
        <span class="pc-corner br">${r}<i>${s}</i></span>`;
    }
    return el;
  }

  function backEl(size) {
    const el = document.createElement('span');
    el.className = `pcard ${size} back`;
    return el;
  }

  /** 下注筹码飞入底池动画 */
  function flyChipToPot(seatEl) {
    const area = $('#table-area');
    if (!area || !seatEl) return;
    const aRect = area.getBoundingClientRect();
    const sRect = seatEl.getBoundingClientRect();
    const pot = $('#pot-display');
    const tRect = pot && !pot.hidden ? pot.getBoundingClientRect() : $('#table-oval').getBoundingClientRect();
    const chip = document.createElement('span');
    chip.className = 'fly-chip';
    const x0 = sRect.left + sRect.width / 2 - aRect.left;
    const y0 = sRect.top + sRect.height / 2 - aRect.top;
    const x1 = tRect.left + tRect.width / 2 - aRect.left;
    const y1 = tRect.top + tRect.height / 2 - aRect.top;
    chip.style.left = `${x0}px`;
    chip.style.top = `${y0}px`;
    area.appendChild(chip);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chip.style.transform = `translate(${x1 - x0}px, ${y1 - y0}px) scale(.45) rotate(220deg)`;
        chip.style.opacity = '0';
      });
    });
    setTimeout(() => chip.remove(), 700);
  }

  /* ---------- 座位 DOM 缓存（keyed 增量更新，避免动画重播） ---------- */
  const seatEls = new Map(); // seat -> el

  function buildSeat(p) {
    const el = document.createElement('div');
    el.className = 'seat';
    el.dataset.seat = p.seat;
    el.innerHTML = `
      <div class="sc-nameplate"><span class="nm"></span><span class="sc-badges"></span></div>
      <div class="seat-card">
        <div class="sc-inner">
          <div class="seat-offline"></div>
          <div class="sc-head">
            <div class="seat-cards"></div>
          </div>
          <div class="sc-pills">
            <span class="sc-pill sc-chips"></span>
            <span class="sc-pill sc-total"></span>
          </div>
          <div class="sc-act"></div>
        </div>
      </div>
      <div class="seat-bet"><span class="chip"></span><span class="bet-amt"></span></div>
    `;
    return el;
  }

  /** 更新一个座位的内容（不重建，保持发牌动画） */
  function updateSeat(el, p, game) {
    el.classList.toggle('folded', !!p.folded || (!p.inHand && game.phase !== 'waiting'));
    el.classList.toggle('acting', game.phase === 'playing' && game.toActSeat === p.seat);
    el.classList.toggle('next-acting', game.phase === 'playing' && game.nextToActSeat === p.seat);
    el.classList.toggle('winner', (game.phase === 'handEnd' || game.phase === 'gameOver') && p.winAmount > 0);

    $('.nm', el).textContent = p.name;
    const chipsEl = $('.sc-chips', el);
    if (p.out) {
      chipsEl.textContent = '已出局';
    } else {
      chipsEl.textContent = `总筹码 ${p.chips}`;
    }
    // 本局累计投入（跨街总和）
    const totalEl = $('.sc-total', el);
    const totalTxt = p.inHand && p.totalBet > 0 ? `本局投入筹码 ${p.totalBet}` : '';
    if (totalEl.textContent !== totalTxt) totalEl.textContent = totalTxt;
    $('.seat-offline', el).textContent = p.online ? '' : '⚡';

    const badges = [];
    if (p.isButton) badges.push('<span class="badge d">庄</span>');
    if (p.isSB) badges.push('<span class="badge sb">小盲</span>');
    if (p.isBB) badges.push('<span class="badge bb">大盲</span>');
    const badgeBox = $('.sc-badges', el);
    if (badgeBox.dataset.sig !== badges.join()) {
      badgeBox.dataset.sig = badges.join();
      badgeBox.innerHTML = badges.join('');
    }

    // 动作气泡：当前街对手的动作（过牌/跟注/加注到/全下）醒目展示
    const betBox = $('.seat-bet', el);
    const a = p.lastAction;
    let show = null;
    if (game.phase === 'playing' && a && a.street === game.street && a.type !== 'blind' && !p.folded) {
      if (a.type === 'check') show = { text: '过牌', amt: 0, cls: 'act-check' };
      else if (a.type === 'call') show = { text: '跟注', amt: a.amount || p.betRound, cls: 'act-call' };
      else if (a.type === 'raise') show = { text: p.allin ? '全下' : '加注到', amt: a.amount || p.betRound, cls: p.allin ? 'act-allin' : 'act-raise' };
      else if (a.type === 'allin') show = { text: '全下', amt: a.amount || p.betRound, cls: 'act-allin' };
    }
    if (show) {
      const sig = `${show.cls}|${show.text}|${show.amt}`;
      if (betBox.dataset.sig !== sig) {
        const isNewBet = betBox.dataset.sig !== '' && show.amt > 0 && game.phase === 'playing';
        betBox.dataset.sig = sig;
        betBox.className = `seat-bet ${show.cls}`;
        betBox.innerHTML = show.amt
          ? `<span class="chip"></span><span class="bet-label">${show.text}</span><b class="bet-amt">${show.amt}</b>`
          : `<span class="bet-label">${show.text}</span>`;
        betBox.style.animation = 'none';
        void betBox.offsetWidth; // 重触发弹跳动画
        betBox.style.animation = '';
        // 加注/全下：座位卡闪光强调
        if (show.cls === 'act-raise' || show.cls === 'act-allin') {
          const card = $('.seat-card', el);
          card.classList.remove('flash');
          void card.offsetWidth;
          card.classList.add('flash');
        }
        // 筹码飞入底池
        if (isNewBet) flyChipToPot(el);
      }
      betBox.style.display = '';
    } else {
      betBox.dataset.sig = '';
      betBox.style.display = 'none';
    }

    // 手牌区：牌背 / 明牌（摊牌时按该玩家组合高亮）
    const cardsBox = $('.seat-cards', el);
    const pHL = hlSetOf(p.highlight);
    let sig;
    if (p.cards && p.cards.length) sig = 'F:' + p.cards.map(cardText).join() + (pHL ? '|' + [...pHL].join() : '');
    else if (p.cardCount > 0) sig = 'B:' + p.cardCount;
    else sig = 'none';
    if (cardsBox.dataset.sig !== sig) {
      cardsBox.dataset.sig = sig;
      cardsBox.innerHTML = '';
      if (sig.startsWith('F:')) {
        for (const c of p.cards) cardsBox.appendChild(cardEl(c, 'pcard-mini', pHL));
      } else if (sig.startsWith('B:')) {
        for (let i = 0; i < p.cardCount; i++) cardsBox.appendChild(backEl('pcard-mini'));
      }
    }

    // 卡内状态行：思考中 / 下一个 / 赢输 / 已弃牌 / 已准备（动作详情在上方气泡）
    const actBox = $('.sc-act', el);
    if (game.phase === 'playing' && game.toActSeat === p.seat) {
      actBox.dataset.eq = '';
      actBox.textContent = '思考中…';
      actBox.className = 'sc-act hot';
    } else if (p.isNext && game.phase === 'playing') {
      actBox.textContent = '⏭ 下一个';
      actBox.className = 'sc-act next';
    } else if (p.equity != null && game.phase === 'playing') {
      // 全下跑牌期：胜率指示器（数字 + 能量条），仅数值变化时更新以保留过渡动画
      const eqSig = `${p.equity}`;
      if (actBox.dataset.eq !== eqSig) {
        actBox.dataset.eq = eqSig;
        const cls = p.equity > 50 ? 'lead' : p.equity < 50 ? 'lag' : 'tie';
        const word = p.equity > 50 ? '领先' : p.equity < 50 ? '落后' : '';
        const fire = p.equity > 50 ? '🔥 ' : '';
        actBox.className = 'sc-act';
        actBox.innerHTML = `<div class="eq ${cls}"><span class="eq-txt">${fire}${p.equity}% ${word}</span><span class="eq-track"><i style="width:${p.equity}%"></i></span></div>`;
      }
    } else if (p.winAmount > 0 && (game.phase === 'handEnd' || game.phase === 'gameOver')) {
      actBox.innerHTML = `胜者 + ${p.winAmount}`;
      actBox.className = 'sc-act hot';
    } else if (p.inHand && !p.folded && (game.phase === 'handEnd' || game.phase === 'gameOver')) {
      const lossNet = Math.max(0, p.totalBet - (p.returned || 0));
      actBox.textContent = lossNet > 0 ? `败者 - ${lossNet}` : '败者';
      actBox.className = 'sc-act lose';
    } else if (p.isReady && game.phase === 'handEnd') {
      actBox.innerHTML = '✓ 已准备';
      actBox.className = 'sc-act hot';
    } else if (p.folded && game.phase !== 'waiting') {
      actBox.textContent = '已弃牌';
      actBox.className = 'sc-act';
    } else {
      actBox.textContent = '';
      actBox.className = 'sc-act';
    }
  }

  /** 椭圆座位布局：以我为基准（底部中央），其余按座位顺时针环绕 */
  function layoutSeats(game) {
    const area = $('#table-area');
    const alive = game.players;
    const maxSeats = Math.max(...alive.map((p) => p.seat), game.mySeat ?? 0) + 1;
    const total = alive.length;
    const center = game.mySeat ?? alive[0]?.seat ?? 0;

    const sorted = [...alive].sort(
      (a, b) => ((a.seat - center + maxSeats) % maxSeats) - ((b.seat - center + maxSeats) % maxSeats)
    );

    const seen = new Set();
    sorted.forEach((p, i) => {
      if (p.seat === center) return; // 自己的座位卡不显示（信息在底部手牌区）
      seen.add(p.seat);
      let el = seatEls.get(p.seat);
      if (!el) {
        el = buildSeat(p);
        seatEls.set(p.seat, el);
        area.appendChild(el);
      }
      updateSeat(el, p, game);
      const theta = (((270 + i * (360 / total)) % 360) * Math.PI) / 180;
      const x = 50 + 37 * Math.cos(theta); // 卡片加宽后收敛横向幅度
      // 座位环上提+外扩：矮屏（手机）上顶部座位不压公共牌
      const y = 40 - 36.5 * Math.sin(theta);
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.zIndex = 10 - i;
    });
    for (const [seat, el] of seatEls) {
      if (!seen.has(seat)) {
        el.remove();
        seatEls.delete(seat);
      }
    }
    fixSeatOverlap(area);
  }

  /** 几何兜底：座位卡与公共牌重叠时按实测位置移开（兼容各引擎盒高/字体渲染差异，含 iOS） */
  function fixSeatOverlap(area) {
    const board = document.querySelector('#board-cards');
    if (!board || !area) return;
    const b = board.getBoundingClientRect();
    const aH = area.clientHeight || 1;
    for (const el of area.querySelectorAll('.seat')) {
      const r = el.getBoundingClientRect();
      const crossed = r.bottom > b.top + 4 && r.top < b.bottom - 4;
      if (!crossed) continue;
      const seatMid = (r.top + r.bottom) / 2;
      const boardMid = (b.top + b.bottom) / 2;
      const up = seatMid < boardMid; // 座位在公牌上方 → 上移，否则下移
      const shift = up ? r.bottom - b.top + 8 : b.bottom - r.top + 8;
      const cur = parseFloat(el.style.top) || 0;
      const delta = (up ? -shift : shift) / aH * 100;
      el.style.top = (cur + delta) + '%';
    }
  }

  /* ---------- 公共牌（双面 3D 翻牌 + 增量发牌） ---------- */
  let lastPot = -1;

  /** 公共牌双面卡：发出时背面滑入，随后 3D 翻到正面 */
  function boardCardEl(card, hlSet, withDim) {
    const wrap = document.createElement('span');
    wrap.className = 'board-card';
    const r = RANK_NAME[card.rank] || card.rank;
    const s = SUIT_SYM[card.suit];
    const frontCls = `pcard pcard-mid bc-front ${isRed(card) ? 'red' : 'black'}${hlClass(card, hlSet, withDim)}`;
    wrap.innerHTML = `
      <span class="bc-inner">
        <span class="${frontCls}">
          <span class="pc-corner">${r}<i>${s}</i></span>
          <span class="pc-center">${s}</span>
          <span class="pc-corner br">${r}<i>${s}</i></span>
        </span>
        <span class="pcard pcard-mid back bc-front-back" aria-hidden="true"></span>
      </span>`;
    return wrap;
  }

  function renderBoard(board, hlSet, withDim = true) {
    const box = $('#board-cards');
    const sig = board.map(cardText).join() + '|' + (hlSet ? [...hlSet].join() : '') + (withDim ? '|d' : '');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const shown = board.length;
    const cards = [...box.querySelectorAll('.board-card')];

    // 更新已有牌的高亮/压暗（不重播动画）
    for (let i = 0; i < Math.min(cards.length, shown); i++) {
      const front = cards[i].querySelector('.bc-front');
      const cls = `pcard pcard-mid bc-front ${isRed(board[i]) ? 'red' : 'black'}${hlClass(board[i], hlSet, withDim)}`;
      if (front.className !== cls) front.className = cls;
    }

    // 新局牌数减少：移除多余
    while (box.querySelectorAll('.board-card').length > shown) {
      const all = [...box.querySelectorAll('.board-card')];
      all[all.length - 1].remove();
    }

    // 增量发新牌：背面滑入 → 停顿一拍 → 3D 翻面
    const existing = box.querySelectorAll('.board-card').length;
    for (let i = existing; i < shown; i++) {
      const wrap = boardCardEl(board[i], hlSet, withDim);
      box.insertBefore(wrap, box.querySelector('.pcard.empty')); // 插到空位之前
      setTimeout(() => wrap.classList.add('flipped'), 300);
    }

    // 空占位数量（补足 5 槽）
    let empties = box.querySelectorAll('.pcard.empty').length;
    const wantEmpty = 5 - shown;
    while (empties > wantEmpty) {
      box.querySelector('.pcard.empty')?.remove();
      empties--;
    }
    while (empties < wantEmpty) {
      box.appendChild(cardEl(null, 'pcard-mid'));
      empties++;
    }
  }

  /* ---------- 我的区域 ---------- */
  function renderMyZone(game) {
    const me = game.players.find((p) => p.seat === game.mySeat);
    const cardsBox = $('#my-cards');
    const isReveal =
      (game.phase === 'handEnd' || game.phase === 'gameOver') &&
      game.result &&
      game.result.type === 'showdown';
    // 高亮来源：摊牌/终局用服务端组合（含压暗），进行中用本地实时组合（只亮不压暗）
    const live = liveCombo(game);
    const endHL = game.phase === 'handEnd' || game.phase === 'gameOver' ? hlSetOf(me && me.highlight) : null;
    const myHL = endHL || (live && live.set) || null;
    const withDim = isReveal;
    const sig = (game.myCards || []).map(cardText).join() + (myHL ? '|' + [...myHL].join() : '') + (withDim ? '|d' : '');
    if (cardsBox.dataset.sig !== sig) {
      cardsBox.dataset.sig = sig;
      cardsBox.innerHTML = '';
      if (game.myCards && game.myCards.length) {
        game.myCards.forEach((c, i) => {
          const el = cardEl(c, 'pcard-big', myHL, withDim);
          el.style.animationDelay = `${i * 0.12}s`; // 依次发到手上
          cardsBox.appendChild(el);
        });
      } else if (me && me.cardCount > 0) {
        cardsBox.appendChild(backEl('pcard-big'));
        cardsBox.appendChild(backEl('pcard-big'));
      }
    }

    const info = $('#my-info');
    if (me) {
      const badges = [me.isButton ? '庄' : '', me.isSB ? '小盲' : '', me.isBB ? '大盲' : ''].filter(Boolean);
      const myEq = me.equity != null ? me.equity : null;
      let eqTag = '';
      if (myEq != null) {
        const cls = myEq > 50 ? 'lead' : myEq < 50 ? 'lag' : 'tie';
        const word = myEq > 50 ? '领先' : myEq < 50 ? '落后' : '';
        const fire = myEq > 50 ? '🔥 ' : '';
        eqTag = `<span class="eq me-eq ${cls}"><span class="eq-txt">${fire}${myEq}% ${word}</span><span class="eq-track"><i style="width:${myEq}%"></i></span></span>`;
      }
      const flags = [
        me.allin ? '<span class="tag allin">ALL-IN</span>' : '',
        eqTag,
        !me.inHand && !me.out ? '<span class="tag out">观战中</span>' : '',
        me.out && game.phase === 'playing' ? '<span class="tag out">已出局</span>' : '',
      ].join('');
      // 状态徽章：胜者金光 / 败者暗红 / 已弃牌灰
      const isEnd = game.phase === 'handEnd' || game.phase === 'gameOver';
      let verdict = '';
      if (isEnd && me.inHand) {
        if (me.winAmount > 0) {
          verdict = `<div class="verdict win">🏆 胜者 <b>+${me.winAmount}</b></div>`;
        } else if (me.folded) {
          verdict = `<div class="verdict folded">已弃牌</div>`;
        } else {
          verdict = `<div class="verdict lose">败者${Math.max(0, me.totalBet - (me.returned || 0)) > 0 ? ` <b>-${Math.max(0, me.totalBet - (me.returned || 0))}</b>` : ''}</div>`;
        }
      } else if (game.phase === 'playing' && me.folded) {
        verdict = `<div class="verdict folded">已弃牌</div>`;
      }
      // 组合展示：进行中用实时组合；局末对未弃牌者展示最终组合（本地计算，含败者）
      let combo = live;
      if (
        !combo &&
        isEnd &&
        game.myCards && game.myCards.length >= 2 &&
        game.board.length >= 3 &&
        me.inHand && !me.folded
      ) {
        const ev = window.Evaluator && Evaluator.evaluate7([...game.myCards, ...game.board]);
        if (ev) combo = { cards: Evaluator.highlightOf(ev), name: ev.name };
      }
      const comboRow = combo
        ? `<div id="my-combo"><span class="mc-label">我的最佳组合</span>${combo.cards.map((c) => comboMiniHTML(c)).join('')}<span class="mc-name">♠ ${combo.name}</span></div>`
        : '';
      const bottom = verdict || comboRow ? `<div id="my-bottom">${comboRow}${verdict}</div>` : '';
      const totalTxt = me.inHand && me.totalBet > 0 ? `<div id="my-total">本局投入筹码 <b>${me.totalBet}</b></div>` : '';
      info.innerHTML = `
        <div id="my-name-row"><b>${Lobby.escapeHtml(me.name)}</b>
          ${badges.map((b) => `<span class="badge d">${b}</span>`).join(' ')}${flags}
        </div>
        <div id="my-chips"><small>总筹码</small> ${me.out ? '—' : me.chips}</div>
        ${totalTxt}
        ${bottom}
      `;
    } else {
      info.innerHTML = '';
    }
  }

  /* ---------- 操作栏 ---------- */
  let raiseOpen = false;
  let sliderVal = 0;

  function renderActionBar(game) {
    const bar = $('#action-bar');
    const me = game.players.find((p) => p.seat === game.mySeat);
    const opts = game.options;

    if (game.phase === 'playing' && me && !me.inHand) {
      raiseOpen = false;
      const inHand = game.players.filter((p) => p.inHand && !p.folded).length;
      bar.innerHTML = `<div id="waiting-hint">👀 ${me.out ? '你已出局 · 观战中' : '下一局自动加入'}<br>当前 <b>${inHand}</b> 人在局中</div>`;
      return;
    }

    if (!opts) {
      raiseOpen = false;
      let hint = '';
      if (game.phase === 'playing') {
        const acting = game.players.find((p) => p.seat === game.toActSeat);
        hint = `等待 <b>${Lobby.escapeHtml(acting ? acting.name : '?')}</b> 行动<span class="dots"></span>`;
      } else if (game.phase === 'handEnd') {
        bar.innerHTML = ''; // 结算信息由底部结算横幅展示
        return;
      } else if (game.phase === 'gameOver') {
        // 终局：底部提供单人返回房间入口
        bar.innerHTML = '<button id="btn-back-room" class="btn btn-gold btn-xl">🏠 返回房间<small>复盘完可回大厅准备下一场</small></button>';
        return;
      } else {
        hint = '等待游戏开始<span class="dots"></span>';
      }
      bar.innerHTML = `<div id="waiting-hint">${hint}</div>`;
      return;
    }

    if (!raiseOpen) {
      sliderVal = opts.minRaiseTo;
      bar.innerHTML = `
        <div id="action-btns">
          <button class="btn btn-danger" data-action="fold">弃牌</button>
          <button class="btn btn-blue" data-action="${opts.canCheck ? 'check' : 'call'}">
            ${opts.canCheck ? '过牌' : opts.callIsAllin ? `全下跟注` : `跟注`}<small>${opts.canCheck ? 'CHECK' : opts.callAmount}</small>
          </button>
          ${opts.canRaise ? `<button class="btn btn-gold" data-action="raise-toggle">加注<small>≥ ${opts.minRaiseTo}</small></button>` : ''}
        </div>
      `;
    } else {
      const { minRaiseTo, maxRaiseTo } = opts;
      const isAllin = sliderVal >= maxRaiseTo;
      bar.innerHTML = `
        <div id="raise-panel">
          <div id="raise-head">
            <span class="rv-label">${isAllin ? '全下' : '加注到'}</span>
            <input id="raise-input" type="number" inputmode="numeric" min="${minRaiseTo}" max="${maxRaiseTo}" step="1" value="${sliderVal}" />
            <span class="rv-max">/ ${maxRaiseTo}</span>
          </div>
          <input id="raise-slider" type="range" min="${minRaiseTo}" max="${maxRaiseTo}" step="1" value="${sliderVal}" />
          <div class="raise-presets">
            <button data-preset="min">最小</button>
            <button data-preset="half">½ 池</button>
            <button data-preset="pot">满池</button>
            <button data-preset="max">全下</button>
          </div>
          <div id="action-btns">
            <button class="btn btn-ghost" data-action="raise-cancel">返回</button>
            <button class="btn btn-gold" data-action="raise-confirm">${isAllin ? `全下 ${sliderVal}` : `加注到 ${sliderVal}`}</button>
          </div>
        </div>
      `;
      syncSliderFill();
    }
  }

  function syncSliderFill() {
    const slider = $('#raise-slider');
    if (!slider || !App.currentGame || !App.currentGame.options) return;
    const { minRaiseTo, maxRaiseTo } = App.currentGame.options;
    const pct = maxRaiseTo > minRaiseTo ? ((sliderVal - minRaiseTo) / (maxRaiseTo - minRaiseTo)) * 100 : 100;
    slider.style.setProperty('--fill', `${pct}%`);
  }

  $('#action-bar').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const preset = btn.dataset.preset;
    if (preset) {
      const opts = App.currentGame && App.currentGame.options;
      if (!opts) return;
      const pot = opts.pot || 0;
      let v;
      if (preset === 'min') v = opts.minRaiseTo;
      else if (preset === 'half') v = Math.round((pot + opts.callAmount) * 1.5 / 2);
      else if (preset === 'pot') v = Math.round((pot + opts.callAmount) * 2);
      else v = opts.maxRaiseTo;
      sliderVal = Math.min(opts.maxRaiseTo, Math.max(opts.minRaiseTo, v));
      renderActionBar(App.currentGame);
      const slider = $('#raise-slider');
      if (slider) slider.value = sliderVal;
      syncSliderFill();
      return;
    }
    if (action === 'raise-toggle') {
      raiseOpen = true;
      sliderVal = App.currentGame.options.minRaiseTo;
      renderActionBar(App.currentGame);
      return;
    }
    if (action === 'raise-cancel') {
      raiseOpen = false;
      renderActionBar(App.currentGame);
      return;
    }
    if (action === 'raise-confirm') {
      raiseOpen = false;
      const opts = App.currentGame && App.currentGame.options;
      if (opts) sliderVal = Math.min(opts.maxRaiseTo, Math.max(opts.minRaiseTo, Math.round(sliderVal)));
      const res = await Net.emitAck('game:action', { type: 'raise', amount: sliderVal });
      if (!res.ok) Toast.show(res.error || '操作失败');
      renderActionBar(App.currentGame);
      return;
    }
    if (action === 'fold' || action === 'check' || action === 'call') {
      raiseOpen = false;
      const res = await Net.emitAck('game:action', { type: action });
      if (!res.ok) Toast.show(res.error || '操作失败');
    }
  });

  /** 同步加注 UI：输入框 / 滑块 / 确认按钮 三方联动 */
  function syncRaiseUI(fromInput = false) {
    const opts = App.currentGame && App.currentGame.options;
    if (!opts) return;
    const isAllin = sliderVal >= opts.maxRaiseTo;
    const txt = isAllin ? `全下 ${sliderVal}` : `加注到 ${sliderVal}`;
    const input = $('#raise-input');
    const slider = $('#raise-slider');
    const label = document.querySelector('.rv-label');
    const confirmBtn = document.querySelector('[data-action="raise-confirm"]');
    if (input && !fromInput) input.value = sliderVal;
    if (input && fromInput) {
      // 输入越界时标红提示（失焦时才纠正）
      const bad = sliderVal < opts.minRaiseTo || sliderVal > opts.maxRaiseTo;
      input.classList.toggle('bad', bad);
    }
    if (slider) slider.value = sliderVal;
    if (label) label.textContent = isAllin ? '全下' : '加注到';
    if (confirmBtn) confirmBtn.innerHTML = txt;
    syncSliderFill();
  }

  $('#action-bar').addEventListener('input', (e) => {
    const opts = App.currentGame && App.currentGame.options;
    if (!opts) return;
    if (e.target.id === 'raise-slider') {
      sliderVal = Number(e.target.value);
      syncRaiseUI();
      return;
    }
    if (e.target.id === 'raise-input') {
      const v = parseInt(e.target.value, 10);
      if (!Number.isNaN(v)) {
        sliderVal = v;
        // 输入过程中仅当值在合法范围内才联动滑块；越界等失焦纠正
        if (v >= opts.minRaiseTo && v <= opts.maxRaiseTo) syncRaiseUI(true);
        else e.target.classList.add('bad');
      }
    }
  });

  // 输入框失焦：越界值纠正回合法范围
  $('#action-bar').addEventListener('change', (e) => {
    if (e.target.id !== 'raise-input') return;
    const opts = App.currentGame && App.currentGame.options;
    if (!opts) return;
    const v = parseInt(e.target.value, 10);
    sliderVal = Number.isNaN(v) ? opts.minRaiseTo : Math.min(opts.maxRaiseTo, Math.max(opts.minRaiseTo, v));
    e.target.value = sliderVal;
    e.target.classList.remove('bad');
    syncRaiseUI();
  });

  /* ---------- 局末结算横幅（底部，不遮挡桌面） ---------- */
  function renderResult(game, room) {
    const bar = $('#settle-bar');
    const me = game.players.find((p) => p.seat === game.mySeat);
    if (game.phase !== 'handEnd' || !game.result) {
      bar.hidden = true;
      $('#btn-show').hidden = true;
      $('#btn-ready').hidden = true;
      return;
    }
    bar.hidden = false;
    const isShowdown = game.result.type === 'showdown';

    // 赢家行（+摊牌牌型胶囊 / 主动亮牌行）
    const lines = game.result.winners
      .map((w) => `🏆 ${Lobby.escapeHtml(w.name)} <span style="color:#ffe9ad">+${w.amount}</span>`)
      .join(' ');
    const extra = isShowdown
      ? game.players
          .filter((p) => p.handName && p.inHand)
          .map((p) => {
            const isWin = p.winAmount > 0;
            const mark = isWin ? '胜者' : (Math.max(0, p.totalBet - (p.returned || 0)) > 0 ? `败者 - ${Math.max(0, p.totalBet - (p.returned || 0))}` : '败者');
            return `<span class="hand-pill${isWin ? ' win' : ' lose'}">${Lobby.escapeHtml(p.name)} · ${p.handName} · ${mark}</span>`;
          })
          .join('')
      : '';
    const shownPlayers = isShowdown ? [] : game.players.filter((p) => p.showedCards && p.cards);
    const shownLines = shownPlayers
      .map((p) => `🃏 ${Lobby.escapeHtml(p.name)} 亮牌 ${p.cards.map(cardText).join(' ')}`)
      .join('<br>');
    $('#result-line').innerHTML =
      `${lines}${extra ? `<span class="hand-pills">${extra}</span>` : ''}` +
      `${shownLines ? `<div class="show-cards">${shownLines}</div>` : ''}`;

    // 亮牌按钮：任何本局玩家（摊牌局全员已亮，无需按钮）
    const showBtn = $('#btn-show');
    showBtn.hidden = !( !isShowdown && me && me.inHand && !me.showedCards);

    // 准备状态与按钮
    const readyBox = $('#ready-status');
    const readyBtn = $('#btn-ready');
    const rd = game.ready;
    if (rd) {
      if (rd.iShouldReady) {
        readyBtn.hidden = rd.iAmReady;
        if (rd.iAmReady) {
          readyBox.innerHTML = `✅ 已准备 <b>${rd.readyCount}/${rd.needed}</b> · 等待 ${fmtPending(rd.pendingNames)}`;
        } else {
          readyBox.innerHTML = `已准备 <b>${rd.readyCount}/${rd.needed}</b>`;
        }
      } else {
        readyBtn.hidden = true;
        readyBox.innerHTML = `等待准备（${rd.readyCount}/${rd.needed}）· ${fmtPending(rd.pendingNames)}`;
      }
    } else {
      readyBtn.hidden = true;
      readyBox.innerHTML = '';
    }
  }

  /* ---------- 主渲染入口 ---------- */
  function render(game, room) {
    $('#tb-room').textContent = `房间 ${room ? room.code : '······'}`;
    $('#tb-blind').textContent = `盲注 ${game.sb}/${game.bb}`;
    $('#tb-street').textContent =
      game.phase === 'playing' ? game.streetName || '' : game.phase === 'handEnd' ? '结算' : '等待中';
    $('#tb-hand').textContent = game.handNo ? `第 ${game.handNo} 局` : '';

    // 高亮：摊牌/终局按主赢家组合（含压暗）；进行中按我的实时组合（只亮不压暗）
    const isReveal =
      (game.phase === 'handEnd' || game.phase === 'gameOver') &&
      game.result &&
      game.result.type === 'showdown';
    const liveHl = liveCombo(game);
    const revealSet = hlSetOf(game.winnerHighlight);
    const useReveal = !!(revealSet && (game.phase === 'handEnd' || game.phase === 'gameOver'));
    renderBoard(game.board, useReveal ? revealSet : (liveHl && liveHl.set) || null, isReveal);
    const potBox = $('#pot-display');
    if (game.pot > 0 && game.phase === 'playing') {
      potBox.hidden = false;
      if (game.pot !== lastPot) {
        $('#pot-amount').textContent = game.pot;
        potBox.classList.remove('pulse');
        void potBox.offsetWidth;
        potBox.classList.add('pulse');
        lastPot = game.pot;
      }
    } else {
      potBox.hidden = true;
      lastPot = -1;
    }

    layoutSeats(game);
    renderMyZone(game);
    renderActionBar(game);
    renderResult(game, room);

    // 房主：牌局中显示「结束牌局」
    const me = game.players.find((p) => p.seat === game.mySeat);
    $('#btn-force-end').hidden = !(me && me.isOwner && (game.phase === 'playing' || game.phase === 'handEnd'));

    // 日志条（变化时重触发淡入）
    const logs = game.logs || [];
    const logText = logs.length ? logs[logs.length - 1] : '';
    const logBar = $('#log-bar');
    if (logBar.textContent !== logText) {
      logBar.textContent = logText;
      logBar.style.animation = 'none';
      void logBar.offsetWidth;
      logBar.style.animation = '';
    }

    // 终局：冠军横幅（不遮挡牌桌，最后一局牌面保留可复盘）
    const banner = $('#champion-banner');
    if (game.phase === 'gameOver' && game.champion) {
      $('#cb-name').textContent = game.champion.name;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  window.Table = { render };
})();
