const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const STEP_HANDLERS = {
  shell: require('./steps/shell'),
  dockerBuild: require('./steps/dockerBuild'),
  dockerPush: require('./steps/dockerPush'),
  composeConvert: require('./steps/composeConvert'),
  k8sDeploy: require('./steps/k8sDeploy'),
  optimize: require('./steps/optimize'),
  devCheck: require('./steps/devCheck'),
};

function insertLog(runId, message, level = 'info') {
  db.prepare(`INSERT INTO run_logs (run_id, message, level) VALUES (?, ?, ?)`).run(runId, message, level);
}

function updateRun(runId, fields) {
  const keys = Object.keys(fields);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE runs SET ${setClause} WHERE id = ?`).run(...values, runId);
}

/**
 * Starts a run for the given job. Executes asynchronously; returns the run id immediately.
 */
function startRun(job, triggerSource = 'manual') {
  const runId = uuidv4();
  const steps = JSON.parse(job.steps);

  db.prepare(
    `INSERT INTO runs (id, job_id, status, trigger_source, started_at) VALUES (?, ?, 'running', ?, datetime('now'))`
  ).run(runId, job.id, triggerSource);

  insertLog(runId, `Run started for job "${job.name}" (trigger: ${triggerSource})`, 'step');

  // Fire and forget - executes in background
  executeSteps(runId, job.id, steps).catch((err) => {
    insertLog(runId, `Run failed: ${err.message}`, 'error');
    updateRun(runId, { status: 'failed', finished_at: new Date().toISOString() });
  });

  return runId;
}

async function executeSteps(runId, jobId, steps) {
  const ctx = {
    vars: {},
    runId,
    jobId,
    log: (message, level = 'info') => insertLog(runId, message, level),
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    updateRun(runId, { current_step: i });

    const handler = STEP_HANDLERS[step.type];
    if (!handler) {
      throw new Error(`Unknown step type: "${step.type}"`);
    }

    ctx.log(`--- Step ${i + 1}/${steps.length}: ${step.type} ---`, 'step');
    await handler.run(step, ctx);
  }

  updateRun(runId, { status: 'success', finished_at: new Date().toISOString(), current_step: steps.length });
  insertLog(runId, `Run completed successfully`, 'step');
}

module.exports = { startRun, STEP_HANDLERS };
