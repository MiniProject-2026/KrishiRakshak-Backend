const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');

// @route POST /api/chat/speech — transcribe audio using Gemini
router.post('/speech', protect, async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) return res.status(400).json({ message: 'Audio data required' });

    const apiKey = process.env.GEMINI_API_KEY;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this audio exactly as spoken. Return only the transcribed text, nothing else.' },
            { inline_data: { mime_type: 'audio/m4a', data: audio } },
          ],
        }],
      },
      { timeout: 20000 }
    );

    const transcript = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    res.json({ transcript: transcript || '' });
  } catch (err) {
    console.error('Speech transcription error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Transcription failed' });
  }
});

// @route POST /api/chat
router.post('/', protect, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({
        reply: "Namaste! 🌿 I'm KrishiRakshak's AI assistant. I can help you with plant care, disease identification, and farming tips."
      });
    }

    const systemInstructionText = `You are a friendly and knowledgeable plant disease detection assistant for the "KrishiRakshak" platform.
You help farmers and gardeners with plant disease identification, treatment, general plant care advice, crop management tips, understanding disease symptoms, and organic and chemical treatment options.
Keep responses helpful, concise, and practical. Use emojis occasionally to be friendly.
If asked about non-plant topics, gently redirect the conversation back to plant health.`;

    // FIXED: Upgraded /v1/ to /v1beta/ in the URL
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        // FIXED: Reverted to snake_case, which is expected by the v1beta REST API
        system_instruction: {
          parts: [{ text: systemInstructionText }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: message }]
          }
        ]
      },
      { timeout: 15000 }
    );

    const reply = response.data.candidates[0].content.parts[0].text;
    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Chat service error. Please try again.' });
  }
});

module.exports = router;