const yaml = require('js-yaml');

const DEFAULT_RESOURCES = {
  requests: { cpu: '100m', memory: '128Mi' },
  limits: { cpu: '500m', memory: '256Mi' },
};

function getPodSpecContainers(doc) {
  // Supports Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob (best-effort)
  if (doc.kind === 'Pod') return doc.spec?.containers;
  if (doc.spec?.template?.spec?.containers) return doc.spec.template.spec.containers;
  if (doc.spec?.jobTemplate?.spec?.template?.spec?.containers) {
    return doc.spec.jobTemplate.spec.template.spec.containers;
  }
  return null;
}

function optimizeContainer(container, changes, containerLabel) {
  // 1. Resource requests/limits
  if (!container.resources || (!container.resources.requests && !container.resources.limits)) {
    container.resources = {
      requests: { ...DEFAULT_RESOURCES.requests },
      limits: { ...DEFAULT_RESOURCES.limits },
    };
    changes.push(`${containerLabel}: added baseline resource requests/limits (cpu/memory) — adjust to match real usage`);
  } else {
    if (!container.resources.requests) {
      container.resources.requests = { ...DEFAULT_RESOURCES.requests };
      changes.push(`${containerLabel}: added missing resource requests`);
    }
    if (!container.resources.limits) {
      container.resources.limits = { ...DEFAULT_RESOURCES.limits };
      changes.push(`${containerLabel}: added missing resource limits`);
    }
  }

  // 2. Probes
  const port = container.ports && container.ports[0] && container.ports[0].containerPort;
  if (!container.readinessProbe && !container.livenessProbe) {
    if (port) {
      container.readinessProbe = {
        httpGet: { path: '/', port },
        initialDelaySeconds: 5,
        periodSeconds: 10,
      };
      container.livenessProbe = {
        httpGet: { path: '/', port },
        initialDelaySeconds: 10,
        periodSeconds: 20,
      };
      changes.push(`${containerLabel}: added readiness/liveness HTTP probes on port ${port}, path "/" — update the path if your app doesn't serve health checks at root`);
    } else {
      changes.push(`${containerLabel}: no exposed port found, so probes were NOT auto-added — add a livenessProbe/readinessProbe manually (exec or tcpSocket) if this container should be health-checked`);
    }
  }

  // 3. Security context
  container.securityContext = container.securityContext || {};
  const sc = container.securityContext;
  let secChanged = false;
  if (sc.runAsNonRoot === undefined) { sc.runAsNonRoot = true; secChanged = true; }
  if (sc.readOnlyRootFilesystem === undefined) { sc.readOnlyRootFilesystem = true; secChanged = true; }
  if (sc.allowPrivilegeEscalation === undefined) { sc.allowPrivilegeEscalation = false; secChanged = true; }
  if (!sc.capabilities) { sc.capabilities = { drop: ['ALL'] }; secChanged = true; }
  if (secChanged) {
    changes.push(`${containerLabel}: hardened securityContext (runAsNonRoot, readOnlyRootFilesystem, no privilege escalation, dropped all capabilities) — if the app writes to disk, mount an emptyDir/volume for those paths`);
  }
}

/**
 * @param {string} content - raw YAML (may contain multiple --- documents)
 * @returns {{ optimized: string, changes: string[] }}
 */
function optimizeK8sManifest(content) {
  const docs = yaml.loadAll(content).filter(Boolean);
  const changes = [];

  docs.forEach((doc, docIdx) => {
    const containers = getPodSpecContainers(doc);
    if (!containers) {
      changes.push(`Document ${docIdx + 1} (${doc.kind || 'unknown kind'}): no container spec found, skipped`);
      return;
    }
    containers.forEach((c, i) => {
      const label = `${doc.kind}/${doc.metadata?.name || `doc${docIdx + 1}`} container "${c.name || i}"`;
      optimizeContainer(c, changes, label);
    });
  });

  const optimized = docs.map((d) => yaml.dump(d)).join('---\n');
  return { optimized, changes };
}

module.exports = { optimizeK8sManifest };
