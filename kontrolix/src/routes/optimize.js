const express = require('express');
const fs = require('fs');
const path = require('path');
const { diffLines } = require('diff');

const { optimizeK8sManifest } = require('../optimize/k8sOptimizer');
const { optimizeCompose } = require('../optimize/composeOptimizer');
const { optimizeDockerfile } = require('../optimize/dockerfileOptimizer');
const { getInsights } = require('../insights/analyzer');

const router = express.Router();

// Insights recommends memory/cpu in Kubernetes-style units (Mi/m) — convert
// for Compose, which uses plain megabytes and decimal cpu counts.
function resourceHintForCompose(k8sHint) {
  if (!k8sHint) return null;
  const memMi = (val) => parseInt(String(val).replace('Mi', ''), 10);
  const cpuM = (val) => parseInt(String(val).replace('m', ''), 10);
  return {
    limits: { cpus: (cpuM(k8sHint.limits.cpu) / 1000).toFixed(2), memory: `${memMi(k8sHint.limits.memory)}M` },
    reservations: { cpus: (cpuM(k8sHint.requests.cpu) / 1000).toFixed(2), memory: `${memMi(k8sHint.requests.memory)}M` },
  };
}

function runOptimizer(type, content, jobId) {
  let resourceHint = null;
  let basedOnHistory = false;

  if (jobId && (type === 'k8s' || type === 'compose')) {
    const insights = getInsights(jobId);
    basedOnHistory = insights.basedOnHistory;
    resourceHint = type === 'k8s' ? insights.recommendedResources : resourceHintForCompose(insights.recommendedResources);
  }

  switch (type) {
    case 'k8s':
      return optimizeK8sManifest(content, { resourceHint, basedOnHistory });
    case 'compose':
      return optimizeCompose(content, { resourceHint, basedOnHistory });
    case 'dockerfile': {
      const { optimized, changes, suggestions } = optimizeDockerfile(content);
      return { optimized, changes, suggestions };
    }
    default:
      throw new Error(`Unknown optimize type "${type}". Use "k8s", "compose", or "dockerfile".`);
  }
}

// POST /api/optimize  { type, content, jobId? }
// Returns a preview: original, optimized, unified change list, and a line-level diff.
// If jobId is provided and that job has devCheck run history, resource sizing
// is computed from real observed usage instead of static defaults.
router.post('/', (req, res) => {
  const { type, content, jobId } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: '"type" and "content" are required' });
  }

  try {
    const result = runOptimizer(type, content, jobId);
    const diff = diffLines(content, result.optimized).map((part) => ({
      value: part.value,
      added: !!part.added,
      removed: !!part.removed,
    }));

    res.json({
      type,
      original: content,
      optimized: result.optimized,
      changes: result.changes,
      suggestions: result.suggestions || [],
      diff,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/optimize/apply  { type, content, filename }
// Re-runs the optimizer (server is stateless between calls) and writes the
// result to disk under ./optimized-output, returning the path.
router.post('/apply', (req, res) => {
  const { type, content, filename, jobId } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: '"type" and "content" are required' });
  }

  try {
    const result = runOptimizer(type, content, jobId);
    const outDir = path.join(process.cwd(), 'optimized-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const safeName = (filename || `optimized-${type}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const outPath = path.join(outDir, safeName);
    fs.writeFileSync(outPath, result.optimized);

    res.json({ path: outPath, changes: result.changes, suggestions: result.suggestions || [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
