const express = require('express');
const db = require('../db');
const { startRun } = require('../jobs/executor');

const router = express.Router();

// POST /webhook/:jobName?secret=xxxx  (or header X-Kontrolix-Secret)
router.post('/:jobName', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE name = ?`).get(req.params.jobName);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.trigger_type !== 'webhook') {
    return res.status(400).json({ error: `Job "${job.name}" is not configured for webhook triggers` });
  }

  const config = job.trigger_config ? JSON.parse(job.trigger_config) : {};
  const providedSecret = req.query.secret || req.headers['x-kontrolix-secret'];

  if (config.secret && config.secret !== providedSecret) {
    return res.status(401).json({ error: 'Invalid or missing webhook secret' });
  }

  const runId = startRun(job, 'webhook');
  res.status(202).json({ runId });
});

module.exports = router;
