const Docker = require('dockerode');

/**
 * step config: {
 *   type: 'dockerPush',
 *   tag: 'myapp:latest'          // defaults to ctx.vars.lastImageTag if omitted
 *   registryAuth: { username, password, serveraddress } // optional
 * }
 */
async function run(step, ctx) {
  const docker = new Docker();
  const tag = step.tag || ctx.vars.lastImageTag;
  if (!tag) throw new Error('dockerPush step requires a "tag" (or a prior dockerBuild step)');

  ctx.log(`Pushing image "${tag}"`, 'step');

  const image = docker.getImage(tag);
  const authconfig = step.registryAuth || undefined;

  const stream = await image.push({ authconfig });

  await new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err, res) => (err ? reject(err) : resolve(res)),
      (event) => {
        if (event.status) {
          const progress = event.progress ? ` ${event.progress}` : '';
          ctx.log(`${event.status}${progress}`);
        }
        if (event.error) ctx.log(event.error, 'error');
      }
    );
  });

  ctx.log(`Image "${tag}" pushed successfully`, 'step');
}

module.exports = { run };
