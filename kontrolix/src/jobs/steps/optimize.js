const fs = require('fs');
const path = require('path');

const { optimizeK8sManifest } = require('../../optimize/k8sOptimizer');
const { optimizeCompose } = require('../../optimize/composeOptimizer');
const { optimizeDockerfile } = require('../../optimize/dockerfileOptimizer');

/**
 * step config: {
 *   type: 'optimize',
 *   target: 'k8s' | 'compose' | 'dockerfile',
 *   inputPath: './k8s/web-deployment.yaml',
 *   outputPath: './k8s-optimized/web-deployment.yaml'   // optional, defaults to inputPath + ".optimized"
 * }
 */
async function run(step, ctx) {
  const { target, inputPath } = step;
  if (!target || !inputPath) throw new Error('optimize step requires "target" and "inputPath"');

  const content = fs.readFileSync(inputPath, 'utf8');
  ctx.log(`Optimizing ${inputPath} (${target})`, 'step');

  let result;
  if (target === 'k8s') result = optimizeK8sManifest(content);
  else if (target === 'compose') result = optimizeCompose(content);
  else if (target === 'dockerfile') result = optimizeDockerfile(content);
  else throw new Error(`Unknown optimize target "${target}"`);

  const outputPath = step.outputPath || `${inputPath}.optimized`;
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, result.optimized);

  (result.changes || []).forEach((c) => ctx.log(`  + ${c}`));
  (result.suggestions || []).forEach((s) => ctx.log(`  ? suggestion: ${s}`));

  ctx.log(`Optimized file written to ${outputPath}`, 'step');
  ctx.vars.lastOptimizedPath = outputPath;
}

module.exports = { run };
