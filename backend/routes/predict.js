const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { protect } = require('../middleware/auth');
const Prediction = require('../models/Prediction');

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

// Get remedies from Gemini
const getRemediesFromGemini = async (disease) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return 'Please consult a plant disease specialist for treatment options.';

    // 1. Define the System Instruction (Persona & Formatting Rules)
    const systemInstructionText = `You are a plant pathology expert. Provide a concise remedy guide in exactly this format:

**About the Disease:**
[1-2 sentences describing the disease]

**Symptoms:**
- [Key symptom 1]
- [Key symptom 2]

**Treatment & Remedies:**
- [Remedy 1]
- [Remedy 2]
- [Remedy 3]

**Prevention:**
- [Prevention tip 1]
- [Prevention tip 2]

Keep it practical and farmer-friendly. If the plant is healthy, provide general care tips instead.`;

    // 2. Define the User Message (The specific disease to look up)
    const userMessage = `Please provide the guide for the following plant condition: "${disease}"`;

    // 3. Call the v1beta endpoint with gemini-2.5-flash
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        system_instruction: {
          parts: [{ text: systemInstructionText }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage }]
          }
        ]
      },
      { timeout: 15000 }
    );

    return response.data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error('Gemini API error:', err.response?.data || err.message);
    return 'Unable to fetch remedies at this time. Please consult a local agricultural expert.';
  }
};

// @route POST /api/predict
router.post('/', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    // Step 1: Use Gemini Vision to verify it's actually a plant leaf
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      const imageBase64 = fs.readFileSync(req.file.path).toString('base64');
      const ext = req.file.mimetype || 'image/jpeg';

      const visionRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          contents: [{
            role: 'user',
            parts: [
              { text: 'Does this image show a plant leaf or any part of a plant? Reply with only YES or NO.' },
              { inline_data: { mime_type: ext, data: imageBase64 } },
            ],
          }],
        },
        { timeout: 15000 }
      );

      const answer = visionRes.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();
      if (!answer || !answer.startsWith('YES')) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          message: 'Please upload a clear photo of a plant leaf. This image does not appear to contain a plant.',
        });
      }
    } catch (visionErr) {
      console.error('Vision check error:', visionErr.message);
      // If vision check fails, continue anyway — don't block the user
    }

    // Call Python ML service
    const formData = new FormData();
    formData.append('image', fs.createReadStream(req.file.path), req.file.originalname);

    const mlResponse = await axios.post(
      `${process.env.ML_SERVICE_URL || 'http://localhost:5001'}/api/predict`,
      formData,
      { headers: formData.getHeaders(), timeout: 30000 }
    );

    const { disease, confidence } = mlResponse.data;

    // Reject low-confidence predictions — likely not a plant leaf
    if (confidence < 0.5) {
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        message: `This doesn't look like a plant leaf image. Please upload a clear photo of a plant leaf. (Confidence: ${(confidence * 100).toFixed(1)}%)`,
      });
    }

    // Parse disease name
    const parts = disease.split('___');
    const plantName = parts[0].replace(/_/g, ' ');
    const diseaseName = parts[1] ? parts[1].replace(/_/g, ' ') : disease;
    const isHealthy = diseaseName.toLowerCase().includes('healthy');

    // Get remedies from Gemini
    const remedies = await getRemediesFromGemini(
      isHealthy ? `${plantName} - healthy plant` : `${plantName} - ${diseaseName}`
    );

    // Save to history
    const prediction = await Prediction.create({
      user: req.user._id,
      imagePath: `/uploads/${req.file.filename}`,
      disease: diseaseName,
      confidence,
      plantName,
      isHealthy,
      remedies,
    });

    res.json({
      _id: prediction._id,
      disease: diseaseName,
      plantName,
      confidence,
      isHealthy,
      remedies,
      imagePath: prediction.imagePath,
    });
  } catch (err) {
    console.error('Prediction error:', err.message);
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ message: 'ML service unavailable. Please ensure the Python service is running.' });
    }
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;