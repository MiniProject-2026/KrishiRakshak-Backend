const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Post = require('../models/Post');

// Get all posts
router.get('/', protect, async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(50);
    res.json(posts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Create post
router.post('/', protect, async (req, res) => {
  try {
    const { content, disease, plantName, imagePath } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: 'Content required' });
    const post = await Post.create({
      user: req.user._id,
      userName: req.user.name,
      content, disease, plantName, imagePath,
    });
    res.status(201).json(post);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Reply to post
router.post('/:id/reply', protect, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: 'Reply required' });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    post.replies.push({ user: req.user._id, userName: req.user.name, content });
    await post.save();
    res.json(post);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Delete post
router.delete('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Not found' });
    if (post.user.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized' });
    await post.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
