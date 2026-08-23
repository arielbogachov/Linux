const db = require('../db');

const FALLBACK = {
  memory: { requestMi: 128, limitMi: 256 },
  cpu: { requestM: 100, limitM: 500 },
};

/**
 * Builds a resource recommendation + failure pattern summary from real
 * devCheck telemetry for a job. Falls back to conservative static defaults
 * when there isn't enough history yet — this is the difference between
 * Kontrolix and a static manifest linter: the more you run a job, the
 * better its sizing gets.
 *
 * @param {string} jobId
 * @returns {{
 *   sampleCount: number,
 *   basedOnHistory: boolean,
 *   recommendedResources: { requests: {cpu,memory}, limits: {cpu,memory} },
 *   recurringFailures: { signature: string, count: number, lastSeen: string, outcome: string }[]
 * }}
 */
function getInsights(jobId) {
  const rows = db.prepare(
    `SELECT * FROM run_insights WHERE job_id = ? ORDER BY ts DESC LIMIT 100`
  ).all(jobId);

  const healthySamples = rows.filter((r) => r.peak_memory_bytes && r.outcome !== 'crashed');

  let recommendedResources;
  let basedOnHistory = false;

  if (healthySamples.length >= 1) {
    const memBytesSorted = healthySamples.map((r) => r.peak_memory_bytes).sort((a, b) => a - b);
    const p95Index = Math.min(memBytesSorted.length - 1, Math.floor(memBytesSorted.length * 0.95));
    const p95MemMi = Math.ceil(memBytesSorted[p95Index] / 1024 / 1024);

    const cpuSamples = healthySamples.map((r) => r.peak_cpu_percent).filter((v) => v !== null && v !== undefined);
    const p95CpuPercent = cpuSamples.length
      ? cpuSamples.sort((a, b) => a - b)[Math.min(cpuSamples.length - 1, Math.floor(cpuSamples.length * 0.95))]
      : null;

    // Request = observed p95 + 20% headroom; limit = request x2 (standard burst allowance)
    const requestMi = Math.max(32, Math.ceil(p95MemMi * 1.2));
    const limitMi = requestMi * 2;
    const requestM = p95CpuPercent ? Math.max(50, Math.ceil(p95CpuPercent * 10 * 1.2)) : FALLBACK.cpu.requestM;
    const limitM = requestM * 3;

    recommendedResources = {
      requests: { cpu: `${requestM}m`, memory: `${requestMi}Mi` },
      limits: { cpu: `${limitM}m`, memory: `${limitMi}Mi` },
    };
    basedOnHistory = true;
  } else {
    recommendedResources = {
      requests: { cpu: `${FALLBACK.cpu.requestM}m`, memory: `${FALLBACK.memory.requestMi}Mi` },
      limits: { cpu: `${FALLBACK.cpu.limitM}m`, memory: `${FALLBACK.memory.limitMi}Mi` },
    };
  }

  // Group failures/warnings by normalized signature to find recurring patterns
  const failureRows = rows.filter((r) => r.outcome !== 'healthy' && r.error_signature);
  const grouped = new Map();
  for (const r of failureRows) {
    const key = r.error_signature;
    if (!grouped.has(key)) grouped.set(key, { signature: key, count: 0, lastSeen: r.ts, outcome: r.outcome });
    const entry = grouped.get(key);
    entry.count += 1;
    if (r.ts > entry.lastSeen) entry.lastSeen = r.ts;
  }
  const recurringFailures = [...grouped.values()]
    .filter((f) => f.count >= 2) // "recurring" = seen more than once
    .sort((a, b) => b.count - a.count);

  return {
    sampleCount: rows.length,
    basedOnHistory,
    recommendedResources,
    recurringFailures,
  };
}

module.exports = { getInsights };
