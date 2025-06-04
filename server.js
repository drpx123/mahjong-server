const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.static('public'));

// 添加健康检查路由
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 游戏房间管理
const rooms = new Map();
const players = new Map();

// 生成房间ID
function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// 清理空房间的定时器
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.length === 0) {
      rooms.delete(roomId);
      console.log(`清理空房间: ${roomId}`);
    }
  }
}, 60000); // 每分钟清理一次

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  // 创建房间
  socket.on('createRoom', (callback) => {
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      players: [socket.id],
      gameState: null,
      started: false,
      createdAt: new Date()
    };
    
    rooms.set(roomId, room);
    players.set(socket.id, { roomId, playerId: 1, joinedAt: new Date() });
    socket.join(roomId);
    
    callback({ success: true, roomId, playerId: 1 });
    console.log(`房间 ${roomId} 已创建，玩家: ${socket.id}`);
  });

  // 加入房间
  socket.on('joinRoom', (roomId, callback) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      callback({ success: false, error: '房间不存在' });
      return;
    }
    
    if (room.players.length >= 2) {
      callback({ success: false, error: '房间已满' });
      return;
    }
    
    room.players.push(socket.id);
    players.set(socket.id, { roomId, playerId: 2, joinedAt: new Date() });
    socket.join(roomId);
    
    callback({ success: true, roomId, playerId: 2 });
    
    // 通知房间内所有玩家
    io.to(roomId).emit('playerJoined', {
      playerId: 2,
      playerCount: room.players.length
    });
    
    console.log(`玩家 ${socket.id} 加入房间 ${roomId}, 当前人数: ${room.players.length}`);
  });

  // 开始游戏
  socket.on('startGame', (gameData) => {
    const player = players.get(socket.id);
    if (!player) return;
    
    const room = rooms.get(player.roomId);
    if (!room || room.players.length < 2) return;
    
    room.gameState = gameData;
    room.started = true;
    
    // 广播游戏开始
    io.to(player.roomId).emit('gameStarted', gameData);
    console.log(`房间 ${player.roomId} 游戏开始`);
  });

  // 游戏动作同步
  socket.on('gameAction', (actionData) => {
    const player = players.get(socket.id);
    if (!player) return;
    
    const room = rooms.get(player.roomId);
    if (!room) return;
    
    // 更新房间游戏状态
    if (actionData.gameState) {
      room.gameState = actionData.gameState;
    }
    
    // 广播给房间内其他玩家
    socket.to(player.roomId).emit('gameAction', {
      action: actionData.action,
      gameState: actionData.gameState,
      playerId: player.playerId,
      timestamp: new Date().toISOString()
    });
    
    console.log(`房间 ${player.roomId} 收到动作: ${actionData.action} 来自玩家 ${player.playerId}`);
  });

  // 聊天消息
  socket.on('chatMessage', (message) => {
    const player = players.get(socket.id);
    if (!player) return;
    
    io.to(player.roomId).emit('chatMessage', {
      playerId: player.playerId,
      message: message,
      timestamp: new Date().toISOString()
    });
  });

  // 心跳检测
  socket.on('ping', (callback) => {
    callback('pong');
  });

  // 断开连接
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      const room = rooms.get(player.roomId);
      if (room) {
        // 从房间移除玩家
        room.players = room.players.filter(id => id !== socket.id);
        
        // 通知其他玩家
        socket.to(player.roomId).emit('playerLeft', {
          playerId: player.playerId
        });
        
        console.log(`玩家 ${socket.id} 离开房间 ${player.roomId}`);
        
        // 如果房间空了，标记为待清理（不立即删除，给重连机会）
        if (room.players.length === 0) {
          console.log(`房间 ${player.roomId} 变为空房间`);
        }
      }
      players.delete(socket.id);
    }
    console.log('用户断开连接:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`麻将游戏服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，开始优雅关闭...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});