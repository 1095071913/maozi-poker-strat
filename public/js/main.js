/** 应用入口：视图路由 / 会话恢复 / 事件接线 */
(() => {
  const $ = (sel) => document.querySelector(sel);

  /* ---------- Toast ---------- */
  let toastTimer = null;
  window.Toast = {
    show(msg, duration = 2400) {
      const el = $('#toast');
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      if (duration > 0) toastTimer = setTimeout(() => (el.hidden = true), duration);
    },
  };

  /* ---------- 会话 ----------
     同一浏览器开多个标签页时，用 ?u=x 区分各自会话（如 localhost:3000/?u=b） */
  const uTag = new URLSearchParams(location.search).get('u');
  const SESSION_KEY = 'poker_session' + (uTag ? `_${uTag}` : '');

  function saveSession(playerId, roomCode) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId, roomCode }));
  }
  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  /* ---------- 视图路由 ---------- */
  function showView(id) {
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === id);
    });
    window.scrollTo(0, 0);
  }

  const App = {
    currentGame: null,
    currentRoom: null,
    localInLobby: false, // 终局后本用户是否已返回大厅（个人视图状态）
    get mySeat() {
      return this.currentGame ? this.currentGame.mySeat : null;
    },
    showView,
    saveSession,
    loadSession,
    clearSession,
    route,
  };
  window.App = App;

  function route() {
    const room = App.currentRoom;
    if (!room) {
      showView('view-lobby');
      return;
    }
    const phase = room.phase;
    if (phase === 'waiting') {
      App.localInLobby = false;
      showView('view-room');
      Lobby.renderRoom(room);
    } else if (phase === 'gameOver' && App.localInLobby) {
      // 终局后该用户已选择返回大厅（个人视图，其他人仍在牌桌复盘）
      showView('view-room');
      Lobby.renderRoom(room);
    } else {
      App.localInLobby = false;
      showView('view-table');
      if (App.currentGame) Table.render(App.currentGame, room);
    }
  }

  /* ---------- 大厅导航 ---------- */
  $('#btn-goto-create').addEventListener('click', () => showView('view-create'));
  $('#btn-goto-join').addEventListener('click', () => showView('view-join'));
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!App.currentRoom) showView('view-lobby');
      else route();
    });
  });

  /* ---------- 牌桌按钮 ---------- */
  $('#btn-ready').addEventListener('click', async () => {
    const res = await Net.emitAck('game:ready', {});
    if (!res.ok) Toast.show(res.error || '操作失败');
  });

  /* ---------- 弃牌收池后赢家亮牌 ---------- */
  $('#btn-show').addEventListener('click', async () => {
    const res = await Net.emitAck('game:showCards', {});
    if (!res.ok) Toast.show(res.error || '操作失败');
  });

  /* ---------- 房主强制结束牌局 ---------- */
  $('#btn-force-end').addEventListener('click', () => {
    $('#overlay-forceend').hidden = false;
  });
  $('#btn-fe-cancel').addEventListener('click', () => ($('#overlay-forceend').hidden = true));
  $('#btn-fe-noScore').addEventListener('click', async () => {
    $('#overlay-forceend').hidden = true;
    const res = await Net.emitAck('game:forceEnd', { mode: 'noScore' });
    if (!res.ok) Toast.show(res.error || '操作失败');
  });
  $('#btn-fe-score').addEventListener('click', async () => {
    $('#overlay-forceend').hidden = true;
    const res = await Net.emitAck('game:forceEnd', { mode: 'score' });
    if (!res.ok) Toast.show(res.error || '操作失败');
  });

  /* ---------- 被房主移出房间 ---------- */
  Net.socket.on('room:kicked', (data) => {
    clearSession();
    App.currentRoom = null;
    App.currentGame = null;
    showView('view-lobby');
    Toast.show(`⚠️ ${data && data.reason ? data.reason : '你已被移出房间'}`, 3500);
  });
  // 返回房间（终局后底部按钮，动态生成，用委托）：单人返回大厅
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-back-room')) {
      App.localInLobby = true;
      App.route();
    }
  });

  /* ---------- Socket 事件 ---------- */
  Net.socket.on('room:update', (room) => {
    App.currentRoom = room;
    route();
    if (room.phase === 'waiting') showView('view-room');
  });

  Net.socket.on('game:update', (game) => {
    App.currentGame = game;
    if (App.currentRoom) {
      const room = App.currentRoom;
      if (room.phase !== game.phase) {
        room.phase = game.phase;
      }
      if (game.phase !== 'waiting' && !(game.phase === 'gameOver' && App.localInLobby)) {
        showView('view-table');
      }
    }
    if (document.querySelector('#view-table.active') || (game.phase !== 'waiting' && App.currentRoom)) {
      Table.render(game, App.currentRoom);
    }
  });

  /* ---------- 会话恢复（页面刷新 / 断线重连后自动回到房间） ---------- */
  async function resume() {
    const s = loadSession();
    if (!s || !s.playerId) return;
    const res = await Net.emitAck('room:join', { roomCode: s.roomCode, playerId: s.playerId });
    if (res.ok) {
      saveSession(res.playerId, res.roomCode);
    } else {
      clearSession();
    }
  }

  // 首次连接与每次断线重连都尝试恢复（重连后 socketId 已变，需重新登记）
  // 邀请链接加入时跳过恢复，优先走链接流程
  Net.socket.on('connect', () => {
    const toast = document.querySelector('#toast');
    if (toast && toast.textContent.includes('断开')) toast.hidden = true;
    if (loadSession() && !window.__linkJoinPending) resume();
  });
  Net.socket.on('disconnect', () => {
    Toast.show('⚠️ 网络断开，正在重连…', 0);
  });

  // 邀请链接进入时停留在加入表单（lobby.js 已预填房号），否则回大厅
  // iOS 矮屏兼容：按实际可视高度切换压缩布局（Safari 的 vh 媒体查询不准）
  function applyViewportClass() {
    document.documentElement.classList.toggle('short-vp', window.innerHeight < 760);
  }
  applyViewportClass();
  window.addEventListener('resize', applyViewportClass);
  window.addEventListener('orientationchange', applyViewportClass);
  if (window.visualViewport) visualViewport.addEventListener('resize', applyViewportClass);

  showView(window.__linkJoinPending ? 'view-join' : 'view-lobby');
})();
