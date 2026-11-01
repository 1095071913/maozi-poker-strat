/**
 * 德州扑克服务器入口
 * Express 静态托管 + Socket.IO 实时通信
 */
const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');

const RoomManager = require('./src/room');

const PORT = process.env.PORT || 18888;

const app = express();
// 静态资源禁用强缓存：每次使用前向服务器验证（304 复用本地缓存），
// 保证改版后手机刷新即可拿到最新页面，又不会重复下载未变化的文件
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next(); // socket.io 自带缓存策略
  res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
});

const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  socket.on('room:create', (data, ack) => {
    const result = rooms.create(socket, data || {});
    if (typeof ack === 'function') ack(result);
  });

  socket.on('room:join', (data, ack) => {
    const result = rooms.join(socket, data || {});
    if (typeof ack === 'function') ack(result);
  });

  socket.on('room:leave', (_data, ack) => {
    rooms.leave(socket);
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('room:ready', (_data, ack) => {
    const res = rooms.toggleLobbyReady(socket);
    if (typeof ack === 'function') ack(res);
  });

  socket.on('room:kick', (data, ack) => {
    const res = rooms.kickPlayer(socket, data || {});
    if (typeof ack === 'function') ack(res);
  });

  socket.on('room:settings', (data, ack) => {
    const res = rooms.updateSettings(socket, data || {});
    if (typeof ack === 'function') ack(res);
  });

  socket.on('room:rename', (data, ack) => {
    const res = rooms.renamePlayer(socket, data || {});
    if (typeof ack === 'function') ack(res);
  });

  socket.on('game:returnLobby', (_data, ack) => {
    const res = rooms.returnToLobby(socket);
    if (typeof ack === 'function') ack(res);
  });

  socket.on('game:forceEnd', (_data, ack) => {
    const res = rooms.forceEnd(socket);
    if (typeof ack === 'function') ack(res);
  });

  socket.on('game:start', (_data, ack) => {
    const err = rooms.startGame(socket);
    if (typeof ack === 'function') ack(err);
  });

  socket.on('game:action', (data, ack) => {
    const err = rooms.playerAction(socket, data || {});
    if (typeof ack === 'function') ack(err);
  });

  socket.on('game:ready', (_data, ack) => {
    const res = rooms.playerReady(socket);
    if (typeof ack === 'function') ack(res);
  });

  socket.on('game:showCards', (_data, ack) => {
    const res = rooms.showCards(socket);
    if (typeof ack === 'function') ack(res);
  });

  socket.on('disconnect', () => {
    rooms.handleDisconnect(socket);
  });
});

// 打印局域网地址，方便手机访问
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🃏 德州扑克服务器已启动`);
  console.log(`   本机访问:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   局域网访问: http://${net.address}:${PORT}  （手机连同一 Wi-Fi 打开此地址）`);
      }
    }
  }
  console.log('');
});
