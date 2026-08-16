const cron = require('node-cron');
const db = require('./db');
const { startRun } = require('./jobs/executor');

const scheduledTasks = new Map(); // jobId -> cron task

function scheduleJob(job) {
  unscheduleJob(job.id);

  if (job.trigger_type !== 'cron') return;

  const config = job.trigger_config ? JSON.parse(job.trigger_config) : {};
  if (!config.schedule || !cron.validate(config.schedule)) {
    console.warn(`[scheduler] Invalid or missing cron schedule for job "${job.name}"`);
    return;
  }

  const task = cron.schedule(config.schedule, () => {
    console.log(`[scheduler] Triggering job "${job.name}" via cron`);
    startRun(job, 'cron');
  });

  scheduledTasks.set(job.id, task);
  console.log(`[scheduler] Scheduled job "${job.name}" with cron "${config.schedule}"`);
}

function unscheduleJob(jobId) {
  const existing = scheduledTasks.get(jobId);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(jobId);
  }
}

function initScheduler() {
  const jobs = db.prepare(`SELECT * FROM jobs WHERE trigger_type = 'cron'`).all();
  jobs.forEach(scheduleJob);
  console.log(`[scheduler] Initialized with ${jobs.length} cron job(s)`);
}

module.exports = { initScheduler, scheduleJob, unscheduleJob };
