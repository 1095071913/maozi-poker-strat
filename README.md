# 🃏 德州扑克 · 联机 Web 版

德州扑克多人联机游戏。朋友各自用手机或电脑浏览器输入房间号即可加入同一牌局，实时对战。

## 🏗️ 示例演示

<img src="images/f61e8b50152ff2205c89426fdb7e0d17.png" alt="null" style="zoom:50%;" />

<img src="images/56f00b13ab39080c3d51071af7dcef6f.png" alt="null" style="zoom:50%;" />

<img src="images/b0aa42d447353525b8379b36d0e9fb26.png" alt="null" style="zoom:50%;" />

<img src="images/26749110f3d11f1721b95089028c07ba.jpg" alt="null" style="zoom:50%;" />

<img src="images/32ade6549567a3090eb8261d952c2231.png" alt="null" style="zoom:50%;" />

<img src="images/6d1306177e2d554641dad5459acdedcc.png" alt="null" style="zoom:50%;" />

## 功能

- **创建房间**：自定义每人筹码（100 ~ 100 万）、大盲注（小盲自动为一半）、人数上限（2~9 人），生成 6 位数字房间号
- **加入房间**：输入房间号 + 昵称即可入座；断线后重新打开页面自动恢复座位与筹码
- **实时人数**：房间大厅实时显示 `当前人数 / 上限`、在线状态、玩家列表
- **完整牌局**：按钮轮转、小盲/大盲、四条街下注（弃牌 / 过牌 / 跟注 / 加注 / 全下）、最小加注校验、边池分层、摊牌比牌（含中文牌型名）、平分底池
- **其他**：45 秒行动倒计时（超时自动过牌/弃牌）、出局观战、全场冠军、房主一键重开（恢复初始筹码）

> **30 秒极简启动**：`npm install && npm start` → 手机连同一 Wi-Fi 打开控制台打印的局域网地址。

## 编译与启动

本项目**无需编译**——前端是原生 HTML/CSS/JS（无构建步骤），后端是纯 Node.js，`npm install` 装完依赖即可直接运行（支持Doker部署）。

### 环境要求

| 依赖 | 版本 | 检查命令 |
|---|---|---|
| Node.js | ≥ 16（推荐 18+） | `node -v` |
| npm | ≥ 8（随 Node 附带） | `npm -v` |

> macOS 可用 `brew install node` 安装；Windows 去 [nodejs.org](https://nodejs.org) 下载 LTS 安装包。

### 安装依赖

```bash
cd poker-strat
npm install        # 只有两个依赖：express + socket.io，几秒装完
```

### 启动

```bash
npm start          # 等价于 node server.js，默认监听 18888 端口
```

自定义端口（比如 8080）：

```bash
PORT=8080 npm start            # macOS / Linux
# Windows PowerShell:
$env:PORT=8080; npm start
```

后台常驻运行（macOS / Linux，日志写入 poker.log）：

```bash
nohup npm start > poker.log 2>&1 &
tail -f poker.log             # 实时看日志
```

启动成功后控制台会打印：

```
🃏 德州扑克服务器已启动
   本机访问:   http://localhost:18888
   局域网访问: http://192.168.x.x:18888  （手机连同一 Wi-Fi 打开此地址）
```

### 停止服务

```bash
# 前台运行：直接 Ctrl + C
# 后台运行：
pkill -f "node server.js"
```

### 手机访问（同局域网）

1. 启动后记下控制台打印的**局域网地址**（如 `http://192.168.124.8:18888`）
2. 手机连接与电脑**同一个 Wi-Fi**，浏览器打开该地址即可
3. 房主创建房间 → 朋友输入 6 位房间号加入开打

> 本机想开多个玩家测试：用 `http://localhost:18888`、`http://localhost:18888/?u=b`、`http://localhost:18888/?u=c` 区分各自的会话。

### Docker 启动（可选）

```bash
docker compose up -d --build     # 构建并后台启动
docker compose logs -f           # 看日志
docker compose down              # 停止
```

- 访问地址不变：本机 `http://localhost:18888`，局域网 `http://<主机IP>:18888`
- 房间状态在进程内存中：**重启容器会清空所有房间**（等同服务器重启）
- 自定义端口：修改 `docker-compose.yml` 中 `ports` 的左侧端口（如 `"8080:18888"`）

### 常见问题

| 现象 | 解决 |
|---|---|
| `EADDRINUSE: port 18888 in use` | 端口被占用：`pkill -f "node server.js"` 杀掉旧进程，或换 `PORT=8080 npm start` |
| 手机打不开局域网地址 | 确认手机与电脑同一 Wi-Fi；macOS 在「系统设置 → 网络 → Wi-Fi → 详细信息」里开启局域网共享/允许传入连接 |
| 页面开着但提示「连接已断开」 | 服务被停止了，重启 `npm start` 后**刷新页面**会自动恢复座位 |
| `command not found: node` | 未安装 Node.js，见上方环境要求 |

## 玩法

1. 一人 **创建房间**（设置筹码 / 盲注 / 人数），把 6 位房间号发给朋友
2. 其余人 **加入房间**，人齐后房主点 **开始游戏**
3. 轮到自己时底部出现操作栏：弃牌 / 过牌 / 跟注 / 加注（滑块 + ½池、1池、全下快捷键）
4. 摊牌自动比牌结算，8 秒后自动开下一局；筹码打空自动出局，最后一人夺冠

## 技术架构

```
poker-strat/
├── server.js            # 入口：Express 静态托管 + Socket.IO 事件路由
├── src/                 # 后端（所有牌局逻辑在服务端，防作弊）
│   ├── room.js          #   房间创建/加入/断线恢复/空房清理
│   ├── game.js          #   牌局引擎：下注轮状态机、边池分层、摊牌结算
│   ├── evaluator.js     #   7 选 5 最佳牌型评估与比较
│   └── cards.js         #   洗牌发牌
├── public/              # 前端（原生 HTML/CSS/JS，无构建步骤，移动端优先）
│   ├── index.html       #   大厅/创建/加入/房间/牌桌五个视图
│   ├── css/style.css    #   深夜赌场视觉系统
│   └── js/              #   net / lobby / table / main
└── test/logic.test.js   # 逻辑自测（无框架，node 直接跑）
```

## 测试

```bash
npm test    # 13 项断言：牌型评估、下注轮、边池、筹码守恒（含随机对战）
```
