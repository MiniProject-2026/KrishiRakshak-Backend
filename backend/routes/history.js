const express = require('express');
const router = express.Router();
const Prediction = require('../models/Prediction');
const { protect } = require('../middleware/auth');

// @route GET /api/history
router.get('/', protect, async (req, res) => {
  try {
    const predictions = await Prediction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(predictions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route DELETE /api/history/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const prediction = await Prediction.findOne({ _id: req.params.id, user: req.user._id });
    if (!prediction) {
      return res.status(404).json({ message: 'Not found' });
    }
    await prediction.deleteOne();
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
