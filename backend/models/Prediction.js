const mongoose = require('mongoose');

const predictionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  imagePath: {
    type: String,
    required: true,
  },
  disease: {
    type: String,
    required: true,
  },
  confidence: {
    type: Number,
    required: true,
  },
  plantName: String,
  isHealthy: {
    type: Boolean,
    default: false,
  },
  remedies: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Prediction', predictionSchema);
