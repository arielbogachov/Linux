const { spawn } = require('child_process');

/**
 * step config: { type: 'shell', command: 'echo hello', cwd: '.' }
 */
async function run(step, ctx) {
  const { command, cwd } = step;
  ctx.log(`$ ${command}`, 'step');

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: cwd || process.cwd(),
      env: process.env,
    });

    child.stdout.on('data', (d) => ctx.log(d.toString().trimEnd()));
    child.stderr.on('data', (d) => ctx.log(d.toString().trimEnd(), 'error'));

    child.on('close', (code) => {
      if (code === 0) {
        ctx.log(`command exited with code 0`, 'step');
        resolve();
      } else {
        reject(new Error(`command failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => reject(err));
  });
}

module.exports = { run };
