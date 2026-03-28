const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const RoomMessage = require('./models/RoomMessage');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/predict', require('./routes/predict'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/history', require('./routes/history'));
app.use('/api/community', require('./routes/community'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'KrishiRakshak API running 🌿' });
});

// Room members tracker: { roomId: Set of { socketId, userName } }
const roomMembers = {};

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  // Join a disease room
  socket.on('join_room', ({ room, userName }) => {
    socket.join(room);
    if (!roomMembers[room]) roomMembers[room] = [];
    roomMembers[room] = roomMembers[room].filter(m => m.socketId !== socket.id);
    roomMembers[room].push({ socketId: socket.id, userName });

    // Notify room
    io.to(room).emit('room_members', roomMembers[room]);
    socket.to(room).emit('user_joined', { userName, time: new Date() });
    console.log(`👤 ${userName} joined room: ${room}`);
  });

  // Send message to room
  socket.on('send_message', async ({ room, message, userName, userId, disease, plantName }) => {
    const msgData = { userName, message, time: new Date(), socketId: socket.id };
    io.to(room).emit('receive_message', msgData);
    // Save to DB
    try {
      await RoomMessage.create({ room, disease, plantName, userName, userId, message });
    } catch (e) { console.error('Message save error:', e.message); }
  });

  // Leave room
  socket.on('leave_room', ({ room, userName }) => {
    socket.leave(room);
    if (roomMembers[room]) {
      roomMembers[room] = roomMembers[room].filter(m => m.socketId !== socket.id);
      io.to(room).emit('room_members', roomMembers[room]);
      socket.to(room).emit('user_left', { userName, time: new Date() });
    }
  });

  socket.on('disconnect', () => {
    // Remove from all rooms
    Object.keys(roomMembers).forEach(room => {
      const before = roomMembers[room]?.length;
      roomMembers[room] = (roomMembers[room] || []).filter(m => m.socketId !== socket.id);
      if (roomMembers[room].length !== before) {
        io.to(room).emit('room_members', roomMembers[room]);
      }
    });
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`🌿 KrishiRakshak server running on port ${PORT}`);
});