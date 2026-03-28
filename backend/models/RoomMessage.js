const mongoose = require('mongoose');

const roomMessageSchema = new mongoose.Schema({
  room: { type: String, required: true, index: true },
  disease: { type: String, required: true },
  plantName: { type: String },
  userName: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('RoomMessage', roomMessageSchema);
