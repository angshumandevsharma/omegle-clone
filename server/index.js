// server/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
let currentPort = DEFAULT_PORT;

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Connection management
const waitingQueue = [];
const partnerBySocketId = new Map();

function pairUsers(socketA, socketB) {
  if (!socketA || !socketB) return;
  partnerBySocketId.set(socketA.id, socketB.id);
  partnerBySocketId.set(socketB.id, socketA.id);

  socketA.emit('partner-found', { partnerId: socketB.id, initiator: true });
  socketB.emit('partner-found', { partnerId: socketA.id, initiator: false });
  console.log(`🤝 Paired ${socketA.id} with ${socketB.id}`);
}

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  socket.on('join', () => {
    console.log(`👤 ${socket.id} wants to join`);
    // Remove duplicates
    for (let i = waitingQueue.length - 1; i >= 0; i--) {
      if (waitingQueue[i].id === socket.id) waitingQueue.splice(i, 1);
    }

    while (waitingQueue.length > 0) {
      const maybe = waitingQueue.shift();
      if (maybe && maybe.connected) {
        pairUsers(maybe, socket);
        return;
      }
    }

    waitingQueue.push(socket);
    console.log(`🕓 ${socket.id} queued (waiting count: ${waitingQueue.length})`);
  });

  socket.on('offer', ({ offer, partnerId }) => {
    const partnerSocket = partnerId
      ? io.sockets.sockets.get(partnerId)
      : io.sockets.sockets.get(partnerBySocketId.get(socket.id));
    if (partnerSocket?.connected) {
      partnerSocket.emit('offer', { offer, partnerId: socket.id });
    }
  });

  socket.on('answer', ({ answer, partnerId }) => {
    const partnerSocket = partnerId
      ? io.sockets.sockets.get(partnerId)
      : io.sockets.sockets.get(partnerBySocketId.get(socket.id));
    if (partnerSocket?.connected) {
      partnerSocket.emit('answer', { answer, partnerId: socket.id });
    }
  });

  socket.on('ice-candidate', ({ candidate, partnerId }) => {
    const partnerSocket = partnerId
      ? io.sockets.sockets.get(partnerId)
      : io.sockets.sockets.get(partnerBySocketId.get(socket.id));
    if (partnerSocket?.connected) {
      partnerSocket.emit('ice-candidate', { candidate });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);

    // Remove from waiting queue
    for (let i = waitingQueue.length - 1; i >= 0; i--) {
      if (waitingQueue[i].id === socket.id) waitingQueue.splice(i, 1);
    }

    const partnerId = partnerBySocketId.get(socket.id);
    if (partnerId) {
      partnerBySocketId.delete(socket.id);
      partnerBySocketId.delete(partnerId);

      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket?.connected) {
        partnerSocket.emit('partner-disconnected');
        waitingQueue.push(partnerSocket);
        console.log(`♻️ Requeued partner ${partnerId}`);
      }
    }
  });
});

// Automatic port retry
function startServer(portToTry) {
  currentPort = portToTry;
  server.listen(currentPort, () => {
    console.log(`✅ Server running on http://localhost:${currentPort}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${currentPort} in use, trying ${currentPort + 1}...`);
      startServer(currentPort + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

// Graceful shutdown
function shutdown() {
  console.log('🛑 Shutting down server...');
  io.close(() => {
    server.close(() => {
      console.log('🟢 Server closed');
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer(currentPort);
