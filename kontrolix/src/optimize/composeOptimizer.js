const yaml = require('js-yaml');

function firstPort(svc) {
  if (!svc.ports || !svc.ports.length) return null;
  const p = String(svc.ports[0]);
  const [hostPort, containerPort] = p.split(':');
  return containerPort || hostPort;
}

function optimizeService(name, svc, changes) {
  // 1. Resource limits (Compose v3 "deploy.resources" — respected by Swarm;
  //    for plain `docker compose up` this documents intent even if not enforced)
  if (!svc.deploy) svc.deploy = {};
  if (!svc.deploy.resources) {
    svc.deploy.resources = {
      limits: { cpus: '0.5', memory: '256M' },
      reservations: { cpus: '0.1', memory: '128M' },
    };
    changes.push(`${name}: added baseline deploy.resources (cpu/memory limits + reservations) — adjust to real usage`);
  }

  // 2. Healthcheck
  if (!svc.healthcheck) {
    const port = firstPort(svc);
    if (port) {
      svc.healthcheck = {
        test: ['CMD', 'wget', '--spider', '-q', `http://localhost:${port}/`],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '10s',
      };
      changes.push(`${name}: added a healthcheck against port ${port} — swap "wget" for curl or an app-specific check if wget isn't in the image`);
    } else {
      changes.push(`${name}: no exposed port found, so a healthcheck was NOT auto-added — add a "test" command manually if this service should be health-checked`);
    }
  }

  // 3. Security hardening
  let secChanged = false;
  if (!svc.security_opt) {
    svc.security_opt = ['no-new-privileges:true'];
    secChanged = true;
  }
  if (!svc.cap_drop) {
    svc.cap_drop = ['ALL'];
    secChanged = true;
  }
  if (svc.read_only === undefined) {
    svc.read_only = true;
    secChanged = true;
  }
  if (svc.user === undefined) {
    svc.user = '1000:1000';
    secChanged = true;
  }
  if (secChanged) {
    changes.push(`${name}: hardened security (no-new-privileges, dropped all capabilities, read-only filesystem, non-root user 1000:1000) — if the container needs to write files, add explicit "tmpfs" or "volumes" entries for those paths`);
  }
}

/**
 * @param {string} content - raw docker-compose.yml content
 * @returns {{ optimized: string, changes: string[] }}
 */
function optimizeCompose(content) {
  const doc = yaml.load(content);
  const changes = [];

  if (!doc.services) {
    return { optimized: content, changes: ['No "services" block found — nothing to optimize'] };
  }

  Object.entries(doc.services).forEach(([name, svc]) => {
    optimizeService(name, svc, changes);
  });

  const optimized = yaml.dump(doc);
  return { optimized, changes };
}

module.exports = { optimizeCompose };
