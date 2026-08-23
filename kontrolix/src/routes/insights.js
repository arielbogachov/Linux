const express = require('express');
const { getInsights } = require('../insights/analyzer');
const db = require('../db');

const router = express.Router();

router.get('/:jobId', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json(getInsights(req.params.jobId));
});

module.exports = router;
