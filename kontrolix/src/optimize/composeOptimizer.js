const yaml = require('js-yaml');
const { scanContent } = require('../security/secretScanner');
const { checkVulnerableBase } = require('../security/vulnImageCheck');
const { tag } = require('./categorize');

const STATEFUL_IMAGE_HINTS = [
  { match: /postgres/i, mountPath: '/var/lib/postgresql/data' },
  { match: /mysql|mariadb/i, mountPath: '/var/lib/mysql' },
  { match: /mongo/i, mountPath: '/data/db' },
  { match: /redis/i, mountPath: '/data' },
  { match: /elasticsearch/i, mountPath: '/usr/share/elasticsearch/data' },
  { match: /rabbitmq/i, mountPath: '/var/lib/rabbitmq' },
  { match: /minio/i, mountPath: '/data' },
];

function firstPort(svc) {
  if (!svc.ports || !svc.ports.length) return null;
  const p = String(svc.ports[0]);
  const [hostPort, containerPort] = p.split(':');
  return containerPort || hostPort;
}

function optimizeService(name, svc, changes, suggestions, resourceHint, basedOnHistory, topLevelVolumes) {
  const resources = resourceHint || { limits: { cpus: '0.5', memory: '256M' }, reservations: { cpus: '0.1', memory: '128M' } };
  const sizingNote = basedOnHistory
    ? "sized from this job's real observed memory/CPU usage (Kontrolix Insights)"
    : 'baseline defaults — add a devCheck step to your pipeline and Kontrolix will size these from real usage instead';

  // 1. Resource limits (Compose v3 "deploy.resources" — respected by Swarm;
  //    for plain `docker compose up` this documents intent even if not enforced)
  if (!svc.deploy) svc.deploy = {};
  if (!svc.deploy.resources) {
    svc.deploy.resources = resources;
    changes.push(tag('performance', `${name}: added deploy.resources (cpu/memory limits + reservations) — ${sizingNote}`));
  }

  // Stateful storage — mount a named volume if this looks like a database/queue and has none
  const hint = STATEFUL_IMAGE_HINTS.find((h) => h.match.test(svc.image || ''));
  if (hint) {
    svc.volumes = svc.volumes || [];
    const alreadyMounted = svc.volumes.some((v) => String(v).includes(hint.mountPath));
    if (!alreadyMounted) {
      const volumeName = `${name}_data`;
      svc.volumes.push(`${volumeName}:${hint.mountPath}`);
      topLevelVolumes.push(volumeName);
      changes.push(tag('storage', `${name}: detected a stateful image ("${svc.image}") with no persistent volume — added a named volume "${volumeName}" mounted at ${hint.mountPath} so \`docker compose down\` doesn't lose data`));
    }
  }

  // Flag outdated base image (suggestion only)
  if (svc.image) {
    const vulnCheck = checkVulnerableBase(svc.image);
    if (vulnCheck.outdated) {
      suggestions.push(tag('security', `${name}: image "${svc.image}" looks outdated: ${vulnCheck.reason}. Consider ${vulnCheck.recommend}.`));
    }
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
      changes.push(tag('reliability', `${name}: added a healthcheck against port ${port} — swap "wget" for curl or an app-specific check if wget isn't in the image`));
    } else {
      changes.push(tag('reliability', `${name}: no exposed port found, so a healthcheck was NOT auto-added — add a "test" command manually if this service should be health-checked`));
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
    changes.push(tag('security', `${name}: hardened security (no-new-privileges, dropped all capabilities, read-only filesystem, non-root user 1000:1000) — if the container needs to write files, add explicit "tmpfs" or "volumes" entries for those paths`));
  }
}

/**
 * @param {string} content - raw docker-compose.yml content
 * @param {object} [options]
 * @param {{limits:object, reservations:object}} [options.resourceHint] - from Kontrolix Insights
 * @param {boolean} [options.basedOnHistory]
 * @returns {{ optimized: string, changes: string[], suggestions: string[] }}
 */
function optimizeCompose(content, options = {}) {
  const doc = yaml.load(content);
  const changes = [];
  const suggestions = [];
  const topLevelVolumes = [];

  const secretFindings = scanContent(content, 'docker-compose.yml');
  secretFindings.forEach((f) => {
    suggestions.push(tag('security', `Possible ${f.type} found on line ${f.line} (${f.redacted}) — move this into an env file referenced via "env_file:" (and keep that file out of git) instead of inlining it.`));
  });

  if (!doc.services) {
    return { optimized: content, changes: [tag('general', 'No "services" block found — nothing to optimize')], suggestions };
  }

  Object.entries(doc.services).forEach(([name, svc]) => {
    optimizeService(name, svc, changes, suggestions, options.resourceHint, options.basedOnHistory, topLevelVolumes);
  });

  if (topLevelVolumes.length) {
    doc.volumes = doc.volumes || {};
    topLevelVolumes.forEach((v) => { doc.volumes[v] = doc.volumes[v] || null; });
  }

  const optimized = yaml.dump(doc);
  return { optimized, changes, suggestions };
}

module.exports = { optimizeCompose };
