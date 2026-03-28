const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const RoomMessage = require('../models/RoomMessage');

// Get last 50 messages for a room
router.get('/:roomId/messages', protect, async (req, res) => {
  try {
    const messages = await RoomMessage.find({ room: req.params.roomId })
      .sort({ createdAt: 1 })
      .limit(50);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all rooms the user has participated in
router.get('/my-rooms', protect, async (req, res) => {
  try {
    const rooms = await RoomMessage.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$room', disease: { $first: '$disease' }, plantName: { $first: '$plantName' }, lastMessage: { $last: '$message' }, lastTime: { $last: '$createdAt' } } },
      { $sort: { lastTime: -1 } },
    ]);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
