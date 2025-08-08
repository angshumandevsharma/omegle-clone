const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000', // frontend URL
    methods: ['GET', 'POST']
  }
});

let waitingUser = null;

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // When user joins queue
  socket.on('join', () => {
    console.log(`👤 ${socket.id} wants to join`);

    if (waitingUser && waitingUser.id !== socket.id) {
      console.log(`🤝 Paired ${waitingUser.id} with ${socket.id}`);

      // First user is initiator
      waitingUser.emit('partner-found', { partnerId: socket.id, initiator: true });
      socket.emit('partner-found', { partnerId: waitingUser.id, initiator: false });

      waitingUser = null; // clear waiting queue
    } else {
      waitingUser = socket;
      console.log('🕓 Waiting for a partner...');
    }
  });

  // Offer relay
  socket.on('offer', ({ offer, partnerId }) => {
    io.to(partnerId).emit('offer', { offer, partnerId: socket.id });
  });

  // Answer relay
  socket.on('answer', ({ answer, partnerId }) => {
    io.to(partnerId).emit('answer', { answer });
  });

  // ICE candidate relay
  socket.on('ice-candidate', ({ candidate, partnerId }) => {
    io.to(partnerId).emit('ice-candidate', { candidate });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    socket.broadcast.emit('partner-disconnected');
  });
});

server.listen(5000, () => {
  console.log('✅ Server running on http://localhost:5000');
});
