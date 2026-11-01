/**
 * 房间管理：创建 / 加入 / 离开 / 断线恢复 / 空房清理
 */
const crypto = require('crypto');
const Game = require('./game');

const ROOM_IDLE_MS = 10 * 60 * 1000; // 全员离线 10 分钟后清理房间
const SWEEP_INTERVAL = 30 * 1000;

let nextPlayerId = 1;

class Room {
  constructor(io, code, settings) {
    this.io = io;
    this.code = code;
    this.settings = settings; // { initialChips, sb, bb, maxPlayers }
    this.players = [];
    this.createdAt = Date.now();
    this.emptySince = null;
    this.lobbyReady = new Set(); // 大厅准备中的玩家 id（房主免准备）
    this.stats = new Map(); // playerId -> { name, wins(冠军次数), losses }
    this.game = new Game(this, settings);
  }

  channel() {
    return `room:${this.code}`;
  }

  playerCount() {
    return this.players.length;
  }

  findPlayerById(id) {
    return this.players.find((p) => p.id === id);
  }

  /** 加入或恢复座位，返回 {ok} 或 {ok:false, error} */
  addPlayer(socket, { playerId, name }) {
    // 断线重连：恢复原座位
    if (playerId) {
      const old = this.players.find((p) => p.id === playerId);
      if (old) {
        if (old.online) return { ok: false, error: '该玩家已在线' };
        old.online = true;
        old.socketId = socket.id;
        socket.join(this.channel());
        this.game.log(`${old.name} 重新连接`);
        this.broadcastAll();
        return { ok: true, roomCode: this.code, playerId: old.id, resumed: true };
      }
    }

    if (this.players.length >= this.settings.maxPlayers) {
      return { ok: false, error: '房间已满' };
    }
    if (this.players.some((p) => p.name === name)) {
      return { ok: false, error: '该昵称已被使用' };
    }

    const usedSeats = new Set(this.players.map((p) => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat++;

    const player = {
      id: nextPlayerId++,
      name,
      seat,
      chips: this.settings.initialChips,
      online: true,
      socketId: socket.id,
      isOwner: this.players.length === 0,
      // 局内状态
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
    };
    this.players.push(player);
    socket.join(this.channel());
    this.game.log(`${name} 加入了房间`);
    this.broadcastAll();
    return { ok: true, roomCode: this.code, playerId: player.id };
  }

  /** 主动离开：移出座位并转移房主 */
  removePlayer(playerId) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const [p] = this.players.splice(idx, 1);
    this.game.log(`${p.name} 离开了房间`);
    if (p.isOwner) {
      const heir = this.players.filter((x) => x.online).sort((a, b) => a.seat - b.seat)[0];
      if (heir) {
        heir.isOwner = true;
        this.game.log(`${heir.name} 成为新房主`);
      }
    }
    this.broadcastAll();
  }

  markOffline(player) {
    player.online = false;
    this.game.log(`${player.name} 掉线了`);
    // 轮到掉线者行动时不代为操作：牌局保持等待，直到其重新连接
    this.broadcastAll();
    // 等待准备阶段有人掉线：延迟几秒再检查（给快速重连留窗口），避免剩下的人干等
    if (this.game.phase === 'handEnd') {
      setTimeout(() => {
        if (!player.online) {
          this.game.checkAutoStart();
          if (this.game.phase === 'handEnd') this.broadcastGame();
        }
      }, 4000);
    }
  }

  resetChips() {
    this.game.reset();
  }

  // ---------- 广播 ----------

  roomState() {
    return {
      code: this.code,
      settings: this.settings,
      phase: this.game.phase,
      playerCount: this.playerCount(),
      lobbyReady: [...this.lobbyReady],
      stats: [...this.stats.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses),
      players: this.players.map((p) => ({
        id: p.id,
        seat: p.seat,
        name: p.name,
        chips: p.chips,
        online: p.online,
        isOwner: p.isOwner,
        out: p.out,
        isReady: this.lobbyReady.has(p.id),
      })),
    };
  }

  /** 终局记录战绩：冠军 +1 胜，房间内其他人各 +1 败 */
  recordChampion(champId) {
    for (const p of this.players) {
      const st = this.stats.get(p.id) || { name: p.name, wins: 0, losses: 0 };
      st.name = p.name; // 改名同步
      if (p.id === champId) st.wins += 1;
      else st.losses += 1;
      this.stats.set(p.id, st);
    }
  }

  broadcastRoom() {
    this.io.to(this.channel()).emit('room:update', this.roomState());
  }

  broadcastGame() {
    const state = this.game;
    for (const p of this.players) {
      if (!p.online || !p.socketId) continue;
      const sock = this.io.sockets.sockets.get(p.socketId);
      if (sock) sock.emit('game:update', state.viewFor(p));
    }
  }

  broadcastAll() {
    this.broadcastRoom();
    this.broadcastGame();
  }
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    setInterval(() => this.sweep(), SWEEP_INTERVAL);
  }

  /** 自动生成昵称（牌手风词库随机组合，撞名时重试） */
  genNickname(existingNames) {
    const a = ['黑桃', '红桃', '梅花', '方块', '幸运', '闪电', '夜行', '冷静', '狂野', '微笑', '传奇', '神秘', '孤注', '梭哈', '河畔', '翻牌', '金底', '筹码'];
    const b = ['侠客', '骑士', '大师', '行者', '玩家', '来宾', '老手', '新秀', '猎手', '赌圣'];
    for (let i = 0; i < 20; i++) {
      const n = a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)];
      if (!existingNames || !existingNames.includes(n)) return n;
    }
    return '玩家' + Math.floor(1000 + Math.random() * 9000);
  }

  genCode() {
    for (;;) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      if (!this.rooms.has(code)) return code;
    }
  }

  roomOf(socket) {
    const code = socket.data.roomCode;
    if (!code) return null;
    return this.rooms.get(code) || null;
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyOnline = room.players.some((p) => p.online);
      if (!anyOnline) {
        if (room.emptySince === null) room.emptySince = now;
        if (now - room.emptySince > ROOM_IDLE_MS) this.rooms.delete(code);
      } else {
        room.emptySince = null;
      }
    }
  }

  create(socket, { name, chips, bigBlind, maxPlayers }) {
    name = String(name || '').trim().slice(0, 5);
    if (!name) name = this.genNickname(); // 留空自动生成
    chips = Math.floor(Number(chips) || 1000);
    bigBlind = Math.floor(Number(bigBlind) || 20);
    maxPlayers = Math.floor(Number(maxPlayers) || 6);
    if (chips < 100 || chips > 1000000) return { ok: false, error: '每人筹码需在 100 ~ 1000000 之间' };
    if (bigBlind < 1 || bigBlind * 2 > chips) return { ok: false, error: '大盲需大于 0 且不超过每人筹码的一半' };
    if (maxPlayers < 2 || maxPlayers > 9) return { ok: false, error: '人数需在 2 ~ 9 之间' };

    this.leave(socket); // 防止重复进房
    const code = this.genCode();
    const room = new Room(this.io, code, {
      initialChips: chips,
      bb: bigBlind,
      sb: Math.max(1, Math.floor(bigBlind / 2)),
      maxPlayers,
    });
    this.rooms.set(code, room);
    const res = room.addPlayer(socket, { name });
    if (res.ok) {
      socket.data.roomCode = code;
      socket.data.playerId = res.playerId;
    } else {
      this.rooms.delete(code);
    }
    return res;
  }

  join(socket, { roomCode, name, playerId }) {
    const code = String(roomCode || '').trim();
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: '房间不存在，请检查房间号' };
    if (!playerId) {
      name = String(name || '').trim().slice(0, 5);
      if (!name) name = this.genNickname(room.players.map((p) => p.name)); // 留空自动生成
    }
    this.leave(socket);
    const res = room.addPlayer(socket, { playerId: playerId ? Number(playerId) : null, name });
    if (res.ok) {
      socket.data.roomCode = code;
      socket.data.playerId = res.playerId;
    }
    return res;
  }

  leave(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    socket.leave(room.channel());
    const p = room.findPlayerById(socket.data.playerId);
    // 游戏进行中保留座位（等同掉线），等待中直接移除
    if (p) {
      if (room.game.phase === 'playing' || room.game.phase === 'handEnd') {
        room.markOffline(p);
      } else {
        room.removePlayer(p.id);
      }
    }
    socket.data.roomCode = null;
    socket.data.playerId = null;
  }

  startGame(socket) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    const p = room.findPlayerById(socket.data.playerId);
    if (!p || !p.isOwner) return { ok: false, error: '只有房主可以开始游戏' };
    const phase = room.game.phase;
    if (phase === 'playing') return { ok: false, error: '牌局已在进行中' };
    if (phase === 'handEnd') return { ok: false, error: '本局还在结算' };
    if (phase === 'gameOver') room.resetChips(); // 终局重开：恢复初始筹码
    const eligible = room.game.eligiblePlayers();
    if (eligible.length < 2) return { ok: false, error: '至少需要 2 名在线且有筹码的玩家' };
    // 大厅准备制：除房主外所有人必须已准备
    const unready = eligible.filter((q) => !q.isOwner && !room.lobbyReady.has(q.id));
    if (unready.length) {
      return { ok: false, error: `还有 ${unready.map((q) => q.name).join('、')} 未准备` };
    }
    room.lobbyReady.clear();
    room.game.startHand();
    return { ok: true };
  }

  /** 大厅准备切换（房主无需准备） */
  toggleLobbyReady(socket) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    if (room.game.phase !== 'waiting' && room.game.phase !== 'gameOver') {
      return { ok: false, error: '牌局进行中无需准备' };
    }
    const p = room.findPlayerById(socket.data.playerId);
    if (!p) return { ok: false, error: '不在房间中' };
    if (p.isOwner) return { ok: false, error: '房主无需准备，点开始即可' };
    if (room.lobbyReady.has(p.id)) {
      room.lobbyReady.delete(p.id);
      room.broadcastRoom();
      return { ok: true, ready: false };
    }
    room.lobbyReady.add(p.id);
    room.broadcastRoom();
    return { ok: true, ready: true };
  }

  /** 房主踢人（仅房间大厅） */
  kickPlayer(socket, { playerId }) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    const owner = room.findPlayerById(socket.data.playerId);
    if (!owner || !owner.isOwner) return { ok: false, error: '只有房主可以踢人' };
    if (room.game.phase === 'playing' || room.game.phase === 'handEnd') {
      return { ok: false, error: '牌局进行中不能踢人' };
    }
    const target = room.findPlayerById(Number(playerId));
    if (!target) return { ok: false, error: '该玩家不在房间' };
    if (target.isOwner) return { ok: false, error: '不能踢自己' };
    const name = target.name;
    const sock = target.socketId ? this.io.sockets.sockets.get(target.socketId) : null;
    room.lobbyReady.delete(target.id);
    room.removePlayer(target.id);
    if (sock) {
      sock.emit('room:kicked', { reason: '你已被房主移出房间' });
      sock.leave(room.channel());
    }
    room.game.log(`房主将 ${name} 移出了房间`);
    room.broadcastAll();
    return { ok: true };
  }

  /** 房主更新房间配置（每人筹码 / 大小盲），等待中生效 */
  updateSettings(socket, { chips, bigBlind }) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    const p = room.findPlayerById(socket.data.playerId);
    if (!p || !p.isOwner) return { ok: false, error: '只有房主可以修改配置' };
    if (room.game.phase === 'playing' || room.game.phase === 'handEnd') {
      return { ok: false, error: '牌局进行中不能修改配置' };
    }
    const newChips = Math.floor(Number(chips));
    const newBB = Math.floor(Number(bigBlind));
    if (!newChips || newChips < 100 || newChips > 1000000) {
      return { ok: false, error: '每人筹码需在 100 ~ 1000000 之间' };
    }
    if (!newBB || newBB < 1 || newBB * 2 > newChips) {
      return { ok: false, error: '大盲需大于 0 且不超过每人筹码的一半' };
    }
    room.settings.initialChips = newChips;
    room.settings.bb = newBB;
    room.settings.sb = Math.max(1, Math.floor(newBB / 2));
    room.game.bb = newBB;
    room.game.sb = room.settings.sb;
    // 每人筹码变化：全员重置为新值
    for (const q of room.players) {
      q.chips = newChips;
      q.out = false;
    }
    room.game.log(`房主更新配置：每人 ${newChips} 筹码，盲注 ${room.settings.sb}/${newBB}`);
    room.broadcastAll();
    return { ok: true };
  }

  /** 修改自己的昵称（仅房间大厅） */
  renamePlayer(socket, { name }) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    if (room.game.phase === 'playing' || room.game.phase === 'handEnd') {
      return { ok: false, error: '牌局进行中不能改名' };
    }
    const p = room.findPlayerById(socket.data.playerId);
    if (!p) return { ok: false, error: '不在房间中' };
    const newName = String(name || '').trim().slice(0, 5);
    if (!newName) return { ok: false, error: '请输入昵称' };
    if (newName === p.name) return { ok: true };
    if (room.players.some((q) => q.id !== p.id && q.name === newName)) {
      return { ok: false, error: '该昵称已被使用' };
    }
    const old = p.name;
    p.name = newName;
    room.game.log(`${old} 改名为 ${newName}`);
    room.broadcastAll();
    return { ok: true };
  }

  /** 终局后返回房间大厅（任何人可触发） */
  returnToLobby(socket) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    if (room.game.phase !== 'gameOver') return { ok: false, error: '牌局尚未结束' };
    room.game.returnToLobby();
    return { ok: true };
  }

  /** 房主强制结束牌局，返回房间大厅（保留各人当前筹码） */
  forceEnd(socket) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    const p = room.findPlayerById(socket.data.playerId);
    if (!p || !p.isOwner) return { ok: false, error: '只有房主可以结束牌局' };
    const phase = room.game.phase;
    if (phase !== 'playing' && phase !== 'handEnd') {
      return { ok: false, error: '当前没有进行中的牌局' };
    }
    room.game.forceEnd();
    room.lobbyReady.clear();
    return { ok: true };
  }

  playerAction(socket, { type, amount }) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    return room.game.act(socket.data.playerId, { type, amount });
  }

  /** 玩家准备下一局 */
  playerReady(socket) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    return room.game.ready(socket.data.playerId);
  }

  /** 弃牌收池后赢家亮牌 */
  showCards(socket) {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, error: '不在房间中' };
    return room.game.showCards(socket.data.playerId);
  }

  handleDisconnect(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    const p = room.findPlayerById(socket.data.playerId);
    if (p) room.markOffline(p);
  }
}

module.exports = RoomManager;
