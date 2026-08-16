const express = require('express');
const fs = require('fs');
const path = require('path');
const { diffLines } = require('diff');

const { optimizeK8sManifest } = require('../optimize/k8sOptimizer');
const { optimizeCompose } = require('../optimize/composeOptimizer');
const { optimizeDockerfile } = require('../optimize/dockerfileOptimizer');

const router = express.Router();

function runOptimizer(type, content) {
  switch (type) {
    case 'k8s':
      return optimizeK8sManifest(content);
    case 'compose':
      return optimizeCompose(content);
    case 'dockerfile': {
      const { optimized, changes, suggestions } = optimizeDockerfile(content);
      return { optimized, changes, suggestions };
    }
    default:
      throw new Error(`Unknown optimize type "${type}". Use "k8s", "compose", or "dockerfile".`);
  }
}

// POST /api/optimize  { type, content }
// Returns a preview: original, optimized, unified change list, and a line-level diff.
router.post('/', (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: '"type" and "content" are required' });
  }

  try {
    const result = runOptimizer(type, content);
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
  const { type, content, filename } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: '"type" and "content" are required' });
  }

  try {
    const result = runOptimizer(type, content);
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
