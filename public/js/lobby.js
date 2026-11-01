/** 大厅 / 创建 / 加入 / 房间等待页 */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  /* ---------- 快捷值芯片（创建房间表单通用） ---------- */
  document.querySelectorAll('.chips-row').forEach((row) => {
    const target = row.dataset.target;
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      const form = row.closest('form');
      const input = form.querySelector(`[name="${target}"]`);
      if (input && input.type !== 'hidden') input.value = btn.dataset.val;
      else if (input) input.value = btn.dataset.val;
      if (target === 'bigBlind') updateSbHint(btn.dataset.val);
    });
  });

  function updateSbHint(bb) {
    $('#sb-hint').textContent = `小盲 ${Math.max(1, Math.floor(Number(bb) / 2))}`;
  }
  const bbInput = document.querySelector('#form-create [name="bigBlind"]');
  bbInput.addEventListener('input', () => updateSbHint(bbInput.value));

  /* ---------- 创建房间 ---------- */
  $('#form-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await Net.emitAck('room:create', {
      name: fd.get('name'),
      chips: fd.get('chips'),
      bigBlind: fd.get('bigBlind'),
      maxPlayers: fd.get('maxPlayers'),
    });
    if (!res.ok) return Toast.show(res.error || '创建失败');
    localStorage.setItem('poker_last_nick', String(fd.get('name') || '').trim());
    App.saveSession(res.playerId, res.roomCode);
    // room:update 广播可能先于 ack 到达（彼时 session 未存），保存后重渲染一次
    if (App.currentRoom) App.route();
  });

  /* ---------- 加入房间 ---------- */
  $('#form-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await Net.emitAck('room:join', {
      roomCode: String(fd.get('code') || '').trim(),
      name: fd.get('name'),
    });
    if (!res.ok) return Toast.show(res.error || '加入失败');
    localStorage.setItem('poker_last_nick', String(fd.get('name') || '').trim());
    App.saveSession(res.playerId, res.roomCode);
    if (App.currentRoom) App.route();
  });

  /* ---------- 邀请链接：#房间号 自动进入加入流程 ---------- */
  (function inviteLink() {
    const m = location.hash.match(/^#(\d{6})$/);
    if (!m) return;
    const code = m[1];
    // 本机已有该房间的会话（断线重开）：不进加入表单，交由 main.js 常规恢复直接回对局
    const uTag = new URLSearchParams(location.search).get('u');
    const key = 'poker_session' + (uTag ? `_${uTag}` : '');
    try {
      const session = JSON.parse(localStorage.getItem(key) || 'null');
      if (session && session.roomCode === code && session.playerId) {
        history.replaceState(null, '', location.pathname + location.search);
        return; // main.js connect 后自动 resume 回房
      }
    } catch { /* 忽略坏数据，走新玩家流程 */ }
    window.__linkJoinPending = true; // 让 main.js 跳过旧会话恢复，优先走链接加入
    history.replaceState(null, '', location.pathname + location.search);
    document.querySelector('#btn-goto-join').click();
    document.querySelector('#form-join [name="code"]').value = code;
    const nameInput = document.querySelector('#form-join [name="name"]');
    nameInput.value = localStorage.getItem('poker_last_nick') || '';
    setTimeout(() => nameInput.focus(), 150);
    setTimeout(() => Toast.show(`🔗 已识别房间号 ${code}，输入昵称点「加入牌局」即可`, 4000), 300);
  })();

  /* ---------- 房间大厅渲染 ---------- */
  function renderRoom(room) {
    $('#room-code').textContent = room.code;
    $('#room-count').textContent = `${room.playerCount}/${room.settings.maxPlayers}`;
    $('#room-chips').textContent = room.settings.initialChips;
    $('#room-blind').textContent = `${room.settings.sb}/${room.settings.bb}`;

    const ul = $('#room-players');
    ul.innerHTML = '';
    const session = App.loadSession();
    const me = session ? room.players.find((p) => p.id === session.playerId) : null;
    let idx = 0;
    // 按净胜场（冠军数-败局数）降序；同分按座位稳定排序
    const stats = room.stats || [];
    const net = (pl) => {
      const st = stats.find((t) => t.name === pl.name);
      return st ? st.wins - st.losses : 0;
    };
    for (const p of [...room.players].sort((a, b) => net(b) - net(a) || a.seat - b.seat)) {
      const li = document.createElement('li');
      li.style.animationDelay = `${idx++ * 60}ms`;
      const initials = p.name.slice(0, 1);
      const hue = `hue-${((p.seat % 8) + 8) % 8}`;
      const isMe = me && p.id === me.id;
      // 房主视角：可踢非自己的玩家
      const canKick = me && me.isOwner && !isMe && (room.phase === 'waiting' || room.phase === 'gameOver');
      const myStat = (room.stats || []).find((t) => t.name === p.name);
      const stTxt = myStat
        ? `<span class="pl-record"><span class="rec rec-win${myStat.wins > 0 ? ' lit' : ''}">🏆 ${myStat.wins}</span><span class="rec rec-loss">x ${myStat.losses}</span></span>`
        : '';
      // 准备标记：房主免准备（视为已就绪），其他人看 lobbyReady
      const readyFlag = p.isOwner ? '<span class="tag owner">免准备</span>'
        : p.isReady ? '<span class="tag ready">✓ 已准备</span>'
        : '<span class="tag unready">未准备</span>';
      li.innerHTML = `
        <div class="avatar ${hue} ${p.online ? '' : 'offline'}">${escapeHtml(initials)}</div>
        <div class="pl-info">
          <div class="pl-name">
            ${escapeHtml(p.name)}${isMe ? ' <span style="font-size:11px;color:var(--dim)">(我)</span>' : ''}
            ${p.isOwner ? '<span class="tag owner">房主</span>' : ''}
            ${p.online ? '' : '<span class="tag offline">离线</span>'}
            ${room.phase === 'waiting' || room.phase === 'gameOver' ? readyFlag : ''}
          </div>
          <div class="pl-chips"><span>筹码 <b>${p.chips}</b></span>${stTxt}</div>
        </div>
        <div class="pl-actions">
          ${canKick ? `<button class="btn-kick" data-kick="${p.id}" title="移出房间">✕ 踢</button>` : '<span class="kick-slot"></span>'}
        </div>
        <div class="pl-status ${p.online ? '' : 'offline'}">${p.online ? '在线' : '离线'}</div>
      `;
      ul.appendChild(li);
    }
    // 空座位占位：暗示还能邀请几位朋友
    const emptyCount = room.settings.maxPlayers - room.players.length;
    for (let i = 0; i < emptyCount && i < 3; i++) {
      const li = document.createElement('li');
      li.className = 'empty-seat';
      li.innerHTML = `
        <div class="avatar empty-seat-av">＋</div>
        <div class="pl-info"><div class="pl-name" style="color:var(--dim)">虚位以待${emptyCount > 1 ? ` · 还能邀请 ${emptyCount} 人` : ''}</div></div>
      `;
      ul.appendChild(li);
    }

    const isOwner = !!(me && me.isOwner);
    const startBtn = $('#btn-start');
    const readyBtn = $('#btn-lobby-ready');
    const tools = $('#owner-tools');
    const tip = $('#wait-tip');
    const readyProgress = $('#ready-progress');
    startBtn.classList.remove('btn-gold');
    readyBtn.hidden = true;
    tools.hidden = !isOwner;
    readyProgress.hidden = true;

    if (room.phase === 'waiting' || room.phase === 'gameOver') {
      // 准备进度（非房主玩家）
      const guests = room.players.filter((p) => !p.isOwner);
      const readyCount = guests.filter((p) => p.isReady).length;
      if (guests.length > 0) {
        readyProgress.hidden = false;
        readyProgress.innerHTML = `准备 <b>${readyCount}/${guests.length}</b>${readyCount < guests.length ? ` · 等待 ${guests.filter((p) => !p.isReady).map((p) => escapeHtml(p.name)).join('、')}` : ' · 全员就绪 🎉'}`;
      }

      if (isOwner) {
        startBtn.hidden = false;
        tip.hidden = true;
        if (room.playerCount < 2) {
          // 人未满：引导邀请而非置灰
          startBtn.disabled = false;
          startBtn.classList.add('btn-gold');
          startBtn.textContent = `🎯 邀请好友加入 · 还差 ${2 - room.playerCount} 人开局`;
          startBtn.dataset.mode = 'invite';
        } else {
          const unready = guests.filter((p) => !p.isReady);
          startBtn.disabled = unready.length > 0;
          startBtn.textContent = '🚀 开始游戏';
          startBtn.dataset.mode = 'start';
          if (unready.length) {
            tip.hidden = false;
            tip.textContent = `还有 ${unready.map((p) => escapeHtml(p.name)).join('、')} 未准备`;
          } else if (room.playerCount < room.settings.maxPlayers) {
            tip.hidden = false;
            tip.textContent = `全员已就绪 · 还能邀请 ${room.settings.maxPlayers - room.playerCount} 位朋友`;
          }
        }
      } else {
        startBtn.hidden = true;
        // 准备切换按钮
        readyBtn.hidden = false;
        if (me && me.isReady) {
          readyBtn.textContent = '↩️ 取消准备';
          readyBtn.classList.remove('btn-primary');
          readyBtn.classList.add('btn-ghost');
          tip.hidden = false;
          tip.textContent = '已准备，等待房主开始…';
        } else {
          readyBtn.textContent = '✅ 准备';
          readyBtn.classList.add('btn-primary');
          readyBtn.classList.remove('btn-ghost');
          tip.hidden = false;
          tip.textContent = '准备后房主即可开始游戏';
        }
      }
    } else {
      // playing 等阶段由牌桌视图接管
      startBtn.hidden = true;
      tip.hidden = false;
      tip.textContent = '牌局进行中…';
    }
  }

  $('#btn-start').addEventListener('click', async () => {
    const btn = $('#btn-start');
    if (btn.dataset.mode === 'invite') {
      const code = App.currentRoom ? App.currentRoom.code : '';
      copyRoomCode(code, '发给朋友吧');
      return;
    }
    const res = await Net.emitAck('game:start', {});
    if (!res.ok) Toast.show(res.error || '无法开始');
  });

  $('#btn-leave').addEventListener('click', async () => {
    await Net.emitAck('room:leave', {});
    App.clearSession();
    App.showView('view-lobby');
    Toast.show('已离开房间');
  });

  /**
   * 复制房间号：clipboard API（需 HTTPS/localhost）失败时用 execCommand 兜底
   * （手机经局域网 IP 访问不是安全上下文，navigator.clipboard 不可用）
   */
  function copyText(text) {
    return new Promise((resolve) => {
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
        document.body.removeChild(ta);
        resolve(ok);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => resolve(true)).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  /** 复制邀请链接：地址#房间号，朋友浏览器打开即可自动加入 */
  async function copyRoomCode(code, extra = '') {
    const url = `${location.origin}${location.pathname}#${code}`;
    const ok = await copyText(url);
    Toast.show(
      ok
        ? `✅ 邀请链接已复制${extra ? '，' + extra : ''}，朋友打开即可加入`
        : `复制失败，请让朋友访问 ${url}`,
      3500
    );
  }

  /* ---------- 大厅准备切换 ---------- */
  $('#btn-lobby-ready').addEventListener('click', async () => {
    const res = await Net.emitAck('room:ready', {});
    if (!res.ok) Toast.show(res.error || '操作失败');
  });

  /* ---------- 踢人 ---------- */
  $('#room-players').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-kick]');
    if (!btn) return;
    const id = Number(btn.dataset.kick);
    const room = App.currentRoom;
    const target = room && room.players.find((p) => p.id === id);
    if (!target) return;
    if (!window.confirm(`确定将「${target.name}」移出房间？`)) return;
    const res = await Net.emitAck('room:kick', { playerId: id });
    if (!res.ok) Toast.show(res.error || '操作失败');
    else Toast.show(`已将 ${target.name} 移出房间`);
  });

  /* ---------- 房间设置（房主） ---------- */
  $('#btn-settings').addEventListener('click', () => {
    const room = App.currentRoom;
    if (!room) return;
    const f = $('#form-settings');
    f.querySelector('[name="chips"]').value = room.settings.initialChips;
    f.querySelector('[name="bigBlind"]').value = room.settings.bb;
    updateSettingsSbHint(room.settings.bb);
    $('#overlay-settings').hidden = false;
  });
  $('#btn-settings-close').addEventListener('click', () => ($('#overlay-settings').hidden = true));

  const bbSettingsInput = document.querySelector('#form-settings [name="bigBlind"]');
  bbSettingsInput.addEventListener('input', () => updateSettingsSbHint(bbSettingsInput.value));
  function updateSettingsSbHint(bb) {
    $('#sb-hint-settings').textContent = `小盲 ${Math.max(1, Math.floor(Number(bb) / 2))}`;
  }

  $('#form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await Net.emitAck('room:settings', {
      chips: fd.get('chips'),
      bigBlind: fd.get('bigBlind'),
    });
    if (!res.ok) return Toast.show(res.error || '保存失败');
    $('#overlay-settings').hidden = true;
    Toast.show('✅ 房间配置已更新');
  });

  /* ---------- 改名 ---------- */
  $('#btn-rename').addEventListener('click', () => {
    const room = App.currentRoom;
    const session = App.loadSession();
    const me = room && session ? room.players.find((p) => p.id === session.playerId) : null;
    $('#form-rename [name="name"]').value = me ? me.name : '';
    $('#overlay-rename').hidden = false;
  });
  $('#btn-rename-close').addEventListener('click', () => ($('#overlay-rename').hidden = true));

  $('#form-rename').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    const res = await Net.emitAck('room:rename', { name });
    if (!res.ok) return Toast.show(res.error || '改名失败');
    $('#overlay-rename').hidden = true;
    Toast.show('✅ 昵称已更新');
  });

  // 点击房间号复制
  $('#room-code').addEventListener('click', () => {
    const code = $('#room-code').textContent;
    copyRoomCode(code);
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Lobby = { renderRoom, escapeHtml };
})();
