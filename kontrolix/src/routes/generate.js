const express = require('express');
const { detectStack, generateDockerfile } = require('../generate/dockerfileGenerator');

const router = express.Router();

// POST /api/generate/detect  { files: [{ name, content? }] }
router.post('/detect', (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: '"files" (array of {name, content?}) is required' });
  }
  try {
    res.json(detectStack(files));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/generate/dockerfile  { stack, port, startCommand, buildCommand }
router.post('/dockerfile', (req, res) => {
  const { stack, port, startCommand, buildCommand } = req.body;
  if (!stack || !port) {
    return res.status(400).json({ error: '"stack" and "port" are required' });
  }
  try {
    const dockerfile = generateDockerfile({ stack, port, startCommand, buildCommand });
    res.json({ dockerfile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
