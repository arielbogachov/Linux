const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { startRun } = require('../jobs/executor');
const { scheduleJob, unscheduleJob } = require('../scheduler');

const router = express.Router();

function serializeJob(job) {
  return {
    ...job,
    steps: JSON.parse(job.steps),
    trigger_config: job.trigger_config ? JSON.parse(job.trigger_config) : null,
  };
}

// ---- Jobs ----

router.get('/jobs', (req, res) => {
  const jobs = db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`).all();
  res.json(jobs.map(serializeJob));
});

router.get('/jobs/:id', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(serializeJob(job));
});

router.post('/jobs', (req, res) => {
  const { name, description, steps, trigger_type, trigger_config } = req.body;
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'name and non-empty steps[] are required' });
  }

  const id = uuidv4();
  try {
    db.prepare(
      `INSERT INTO jobs (id, name, description, steps, trigger_type, trigger_config)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      description || '',
      JSON.stringify(steps),
      trigger_type || 'manual',
      trigger_config ? JSON.stringify(trigger_config) : null
    );
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  if (job.trigger_type === 'cron') scheduleJob(job);

  res.status(201).json(serializeJob(job));
});

router.put('/jobs/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });

  const { name, description, steps, trigger_type, trigger_config } = req.body;

  db.prepare(
    `UPDATE jobs SET name = ?, description = ?, steps = ?, trigger_type = ?, trigger_config = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    description ?? existing.description,
    steps ? JSON.stringify(steps) : existing.steps,
    trigger_type ?? existing.trigger_type,
    trigger_config ? JSON.stringify(trigger_config) : existing.trigger_config,
    req.params.id
  );

  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (job.trigger_type === 'cron') {
    scheduleJob(job);
  } else {
    unscheduleJob(job.id);
  }

  res.json(serializeJob(job));
});

router.delete('/jobs/:id', (req, res) => {
  unscheduleJob(req.params.id);
  db.prepare(`DELETE FROM runs WHERE job_id = ?`).run(req.params.id); // cascade-ish cleanup
  db.prepare(`DELETE FROM jobs WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---- Runs ----

router.post('/jobs/:id/run', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const runId = startRun(job, 'manual');
  res.status(202).json({ runId });
});

router.get('/jobs/:id/runs', (req, res) => {
  const runs = db.prepare(`SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC`).all(req.params.id);
  res.json(runs);
});

router.get('/runs/:id', (req, res) => {
  const run = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

router.get('/runs/:id/logs', (req, res) => {
  const logs = db.prepare(`SELECT * FROM run_logs WHERE run_id = ? ORDER BY id ASC`).all(req.params.id);
  res.json(logs);
});

router.get('/runs', (req, res) => {
  const runs = db.prepare(`
    SELECT runs.*, jobs.name as job_name FROM runs
    JOIN jobs ON jobs.id = runs.job_id
    ORDER BY runs.started_at DESC LIMIT 50
  `).all();
  res.json(runs);
});

module.exports = router;
