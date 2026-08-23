const Docker = require('dockerode');
const db = require('../../db');

/**
 * step config: {
 *   type: 'devCheck',
 *   image: 'myapp:latest',          // defaults to ctx.vars.lastImageTag
 *   port: 3000,                     // optional — container port to health-check
 *   healthPath: '/',                // optional, default '/'
 *   startupTimeoutSeconds: 15,      // how long to wait for the container to prove it's alive
 *   failOnUnhealthy: false          // crash/non-zero-exit always fails the step; this controls
 *                                   // whether a slow/unresponsive health check does too
 * }
 *
 * This is what makes Kontrolix's optimizer different from a static linter:
 * it actually runs the container and remembers what happened, in run_insights.
 */

function normalizeErrorSignature(logText) {
  const lines = logText.split('\n');
  const errorLine = lines.find((l) => /error|exception|panic:|fatal|traceback/i.test(l));
  if (!errorLine) return null;
  // Strip anything that looks like a timestamp, id, or path so the same error
  // from different runs groups together instead of each being "unique".
  return errorLine
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '')
    .replace(/0x[0-9a-f]+/gi, '')
    .replace(/\/[^\s:]+/g, '<path>')
    .trim()
    .slice(0, 200);
}

function recordInsight(ctx, fields) {
  db.prepare(
    `INSERT INTO run_insights (run_id, job_id, image, outcome, exit_code, oom_killed, peak_memory_bytes, peak_cpu_percent, error_signature, log_excerpt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ctx.runId,
    ctx.jobId,
    fields.image,
    fields.outcome,
    fields.exitCode ?? null,
    fields.oomKilled ? 1 : 0,
    fields.peakMemoryBytes ?? null,
    fields.peakCpuPercent ?? null,
    fields.errorSignature ?? null,
    fields.logExcerpt ?? null
  );
}

function cpuPercentFromStats(stats) {
  try {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage || [1]).length;
    if (systemDelta > 0 && cpuDelta > 0) return (cpuDelta / systemDelta) * cpuCount * 100;
  } catch {
    /* stats shape varies by platform/cgroup version — best effort only */
  }
  return null;
}

async function run(step, ctx) {
  const docker = new Docker();
  const image = step.image || ctx.vars.lastImageTag;
  if (!image) throw new Error('devCheck step requires "image" (or a prior dockerBuild step)');

  const port = step.port;
  const healthPath = step.healthPath || '/';
  const timeoutMs = (step.startupTimeoutSeconds || 15) * 1000;

  ctx.log(`Starting ephemeral container from "${image}" for a dev/smoke check`, 'step');

  const exposedPorts = {};
  const portBindings = {};
  if (port) {
    exposedPorts[`${port}/tcp`] = {};
    portBindings[`${port}/tcp`] = [{ HostPort: '0' }]; // let Docker pick a free host port
  }

  const container = await docker.createContainer({
    Image: image,
    ExposedPorts: exposedPorts,
    HostConfig: { PortBindings: portBindings, AutoRemove: false },
  });

  let outcome = 'healthy';
  let exitCode = null;
  let oomKilled = false;
  let peakMemoryBytes = null;
  let peakCpuPercent = null;
  let logExcerpt = '';
  let errorSignature = null;

  try {
    await container.start();

    // Race: either the container exits on its own (crash), or we hit the timeout
    // (meaning it stayed up, which for a web service is the expected/good outcome).
    const waitPromise = container.wait().then((res) => ({ exited: true, statusCode: res.StatusCode }));
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ exited: false }), timeoutMs));
    const result = await Promise.race([waitPromise, timeoutPromise]);

    // Sample resource usage once, regardless of outcome
    try {
      const stats = await container.stats({ stream: false });
      peakMemoryBytes = stats.memory_stats?.usage ?? null;
      peakCpuPercent = cpuPercentFromStats(stats);
    } catch {
      /* container may have already exited before stats could be read */
    }

    const logBuffer = await container.logs({ stdout: true, stderr: true, tail: 200 });
    logExcerpt = logBuffer.toString('utf8').replace(/[\x00-\x09\x0b-\x1f]/g, '').slice(-4000);

    if (result.exited) {
      exitCode = result.statusCode;
      const inspect = await container.inspect().catch(() => null);
      oomKilled = !!inspect?.State?.OOMKilled;

      if (exitCode !== 0 || oomKilled) {
        outcome = oomKilled ? 'crashed' : 'crashed';
        errorSignature = normalizeErrorSignature(logExcerpt) || (oomKilled ? 'OOM killed' : `exited with code ${exitCode}`);
        ctx.log(`Container exited early with code ${exitCode}${oomKilled ? ' (OOM killed)' : ''}`, 'error');
        ctx.log(`--- last log lines ---\n${logExcerpt.split('\n').slice(-15).join('\n')}`, 'error');
      } else {
        ctx.log(`Container exited cleanly with code 0 before the timeout — likely a one-shot task, not a long-running service`, 'step');
      }
    } else {
      ctx.log(`Container is still running after ${step.startupTimeoutSeconds || 15}s (expected for a service)`, 'step');

      if (port) {
        const inspect = await container.inspect();
        const hostPort = inspect.NetworkSettings.Ports[`${port}/tcp`]?.[0]?.HostPort;
        if (hostPort) {
          try {
            const res = await fetch(`http://127.0.0.1:${hostPort}${healthPath}`, { signal: AbortSignal.timeout(5000) });
            if (res.ok) {
              ctx.log(`Health check passed: GET ${healthPath} → ${res.status}`, 'step');
            } else {
              outcome = 'unhealthy';
              ctx.log(`Health check returned ${res.status} on ${healthPath}`, 'error');
            }
          } catch (err) {
            outcome = 'unhealthy';
            errorSignature = `health check failed: ${err.message}`;
            ctx.log(`Health check failed: could not reach port ${port}${healthPath} — ${err.message}`, 'error');
          }
        }
      }
    }

    if (peakMemoryBytes) {
      ctx.log(`Peak memory observed: ${(peakMemoryBytes / 1024 / 1024).toFixed(1)} MiB`, 'step');
    }
    if (peakCpuPercent !== null) {
      ctx.log(`CPU usage sample: ${peakCpuPercent.toFixed(1)}%`, 'step');
    }
  } finally {
    await container.stop({ t: 2 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  }

  recordInsight(ctx, { image, outcome, exitCode, oomKilled, peakMemoryBytes, peakCpuPercent, errorSignature, logExcerpt });
  ctx.vars.devCheckOutcome = outcome;

  if (outcome === 'crashed') {
    throw new Error(`devCheck failed: container crashed (${errorSignature || `exit code ${exitCode}`})`);
  }
  if (outcome === 'unhealthy' && step.failOnUnhealthy) {
    throw new Error(`devCheck failed: container never became healthy (${errorSignature})`);
  }
  if (outcome === 'unhealthy') {
    ctx.log(`devCheck finished with warnings (unhealthy) — not failing the pipeline since failOnUnhealthy is not set`, 'step');
  } else {
    ctx.log(`devCheck passed`, 'step');
  }
}

module.exports = { run };
