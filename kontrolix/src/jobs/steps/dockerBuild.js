const Docker = require('dockerode');
const path = require('path');

/**
 * step config: { type: 'dockerBuild', context: '.', dockerfile: 'Dockerfile', tag: 'myapp:latest' }
 */
async function run(step, ctx) {
  const docker = new Docker(); // connects to local Docker socket
  const context = step.context || '.';
  const dockerfile = step.dockerfile || 'Dockerfile';
  const tag = step.tag;

  if (!tag) throw new Error('dockerBuild step requires a "tag"');

  ctx.log(`Building image "${tag}" from ${path.join(context, dockerfile)}`, 'step');

  const stream = await docker.buildImage(
    { context, src: ['.'] },
    { t: tag, dockerfile }
  );

  await new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err, res) => (err ? reject(err) : resolve(res)),
      (event) => {
        if (event.stream) ctx.log(event.stream.trimEnd());
        if (event.error) ctx.log(event.error, 'error');
      }
    );
  });

  ctx.log(`Image "${tag}" built successfully`, 'step');
  ctx.vars.lastImageTag = tag;
}

module.exports = { run };
