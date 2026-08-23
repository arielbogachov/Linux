const yaml = require('js-yaml');
const { scanContent } = require('../security/secretScanner');
const { checkVulnerableBase } = require('../security/vulnImageCheck');
const { tag } = require('./categorize');

const DEFAULT_RESOURCES = {
  requests: { cpu: '100m', memory: '128Mi' },
  limits: { cpu: '500m', memory: '256Mi' },
};

// image name substring -> where that kind of workload typically keeps its data
const STATEFUL_IMAGE_HINTS = [
  { match: /postgres/i, mountPath: '/var/lib/postgresql/data' },
  { match: /mysql|mariadb/i, mountPath: '/var/lib/mysql' },
  { match: /mongo/i, mountPath: '/data/db' },
  { match: /redis/i, mountPath: '/data' },
  { match: /elasticsearch/i, mountPath: '/usr/share/elasticsearch/data' },
  { match: /cassandra/i, mountPath: '/var/lib/cassandra' },
  { match: /rabbitmq/i, mountPath: '/var/lib/rabbitmq' },
  { match: /minio/i, mountPath: '/data' },
  { match: /influxdb/i, mountPath: '/var/lib/influxdb2' },
];

function getPodSpecContainers(doc) {
  // Supports Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob (best-effort)
  if (doc.kind === 'Pod') return doc.spec?.containers;
  if (doc.spec?.template?.spec?.containers) return doc.spec.template.spec.containers;
  if (doc.spec?.jobTemplate?.spec?.template?.spec?.containers) {
    return doc.spec.jobTemplate.spec.template.spec.containers;
  }
  return null;
}

function getPodSpec(doc) {
  // The spec object that directly owns `containers` AND `volumes` (sibling keys)
  if (doc.kind === 'Pod') return doc.spec;
  if (doc.spec?.template?.spec) return doc.spec.template.spec;
  if (doc.spec?.jobTemplate?.spec?.template?.spec) return doc.spec.jobTemplate.spec.template.spec;
  return null;
}

function detectStatefulHint(image) {
  return STATEFUL_IMAGE_HINTS.find((h) => h.match.test(image || ''));
}

function optimizeContainer(container, changes, containerLabel, resourceHint, basedOnHistory) {
  const resources = resourceHint || DEFAULT_RESOURCES;
  const sizingNote = basedOnHistory
    ? 'sized from this job\'s real observed memory/CPU usage (Kontrolix Insights), not a generic guess'
    : 'baseline defaults — run this job with a devCheck step a few times and Kontrolix will size these from real usage instead';

  // 1. Resource requests/limits
  if (!container.resources || (!container.resources.requests && !container.resources.limits)) {
    container.resources = {
      requests: { ...resources.requests },
      limits: { ...resources.limits },
    };
    changes.push(tag('performance', `${containerLabel}: added resource requests/limits — ${sizingNote}`));
  } else {
    if (!container.resources.requests) {
      container.resources.requests = { ...resources.requests };
      changes.push(tag('performance', `${containerLabel}: added missing resource requests (${sizingNote})`));
    }
    if (!container.resources.limits) {
      container.resources.limits = { ...resources.limits };
      changes.push(tag('performance', `${containerLabel}: added missing resource limits (${sizingNote})`));
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
      changes.push(tag('reliability', `${containerLabel}: added readiness/liveness HTTP probes on port ${port}, path "/" — update the path if your app doesn't serve health checks at root`));
    } else {
      changes.push(tag('reliability', `${containerLabel}: no exposed port found, so probes were NOT auto-added — add a livenessProbe/readinessProbe manually (exec or tcpSocket) if this container should be health-checked`));
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
    changes.push(tag('security', `${containerLabel}: hardened securityContext (runAsNonRoot, readOnlyRootFilesystem, no privilege escalation, dropped all capabilities) — if the app writes to disk, mount an emptyDir/volume for those paths`));
  }

  // 4. Flag outdated base images referenced in `image:` (suggestion only)
  if (container.image) {
    const vulnCheck = checkVulnerableBase(container.image);
    if (vulnCheck.outdated) {
      return { suggestion: tag('security', `${containerLabel}: image "${container.image}" looks outdated: ${vulnCheck.reason}. Consider ${vulnCheck.recommend}.`) };
    }
  }
  return null;
}

/**
 * If a container's image looks stateful (a database, message queue, etc.), wire up
 * a PersistentVolumeClaim + volumeMount so restarts don't silently lose data — this
 * is the kind of thing people forget until they lose data in a pod restart.
 */
function addStatefulStorage(doc, podSpec, container, changes) {
  const hint = detectStatefulHint(container.image);
  if (!hint) return null;

  const alreadyMounted = (container.volumeMounts || []).some((vm) => vm.mountPath === hint.mountPath);
  if (alreadyMounted) return null;

  const appName = doc.metadata?.name || 'app';
  const pvcName = `${appName}-data`;
  const volumeName = `${appName}-data-vol`;

  container.volumeMounts = container.volumeMounts || [];
  container.volumeMounts.push({ name: volumeName, mountPath: hint.mountPath });

  podSpec.volumes = podSpec.volumes || [];
  podSpec.volumes.push({ name: volumeName, persistentVolumeClaim: { claimName: pvcName } });

  changes.push(tag('storage', `${appName}: detected a stateful image ("${container.image}") with no persistent volume — added a PersistentVolumeClaim ("${pvcName}", 1Gi default) mounted at ${hint.mountPath} so pod restarts don't lose data. Adjust the size and storageClassName for your cluster.`));

  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: pvcName },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: { requests: { storage: '1Gi' } },
    },
  };
}

/**
 * Default-deny-except-same-namespace NetworkPolicy — the single most commonly
 * skipped K8s security control, since a fresh cluster allows all pod-to-pod
 * traffic by default.
 */
function generateNetworkPolicy(doc, containers, changes) {
  const appName = doc.metadata?.name;
  if (!appName) return null;

  const ports = containers.flatMap((c) => c.ports || []).map((p) => ({ protocol: 'TCP', port: p.containerPort }));
  if (ports.length === 0) {
    changes.push(tag('security', `${appName}: no container ports found, so a NetworkPolicy was NOT generated — add one manually once you know which ports need to accept traffic`));
    return null;
  }

  changes.push(tag('security', `${appName}: generated a NetworkPolicy restricting inbound traffic to pods in the same namespace on ${ports.map((p) => p.port).join(', ')} — without this, any pod in the cluster can reach this one`));

  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: `${appName}-network-policy` },
    spec: {
      podSelector: { matchLabels: doc.metadata?.labels || { app: appName } },
      policyTypes: ['Ingress'],
      ingress: [{ from: [{ podSelector: {} }], ports }],
    },
  };
}

/**
 * @param {string} content - raw YAML (may contain multiple --- documents)
 * @param {object} [options]
 * @param {{requests:object, limits:object}} [options.resourceHint] - from Kontrolix Insights, overrides static defaults
 * @param {boolean} [options.basedOnHistory] - whether resourceHint came from real run telemetry
 * @returns {{ optimized: string, changes: string[], suggestions: string[] }}
 */
function optimizeK8sManifest(content, options = {}) {
  const docs = yaml.loadAll(content).filter(Boolean);
  const changes = [];
  const suggestions = [];
  const extraDocs = [];

  // Secret scan first — this runs on the raw manifest text (e.g. an inline env value)
  const secretFindings = scanContent(content, 'manifest');
  secretFindings.forEach((f) => {
    suggestions.push(tag('security', `Possible ${f.type} found on line ${f.line} (${f.redacted}) — move this into a Kubernetes Secret and reference it via env/valueFrom instead of inlining it in the manifest.`));
  });

  docs.forEach((doc, docIdx) => {
    const containers = getPodSpecContainers(doc);
    const podSpec = getPodSpec(doc);

    if (!containers || !podSpec) {
      changes.push(tag('general', `Document ${docIdx + 1} (${doc.kind || 'unknown kind'}): no container spec found, skipped`));
      return;
    }

    containers.forEach((c, i) => {
      const label = `${doc.kind}/${doc.metadata?.name || `doc${docIdx + 1}`} container "${c.name || i}"`;
      const result = optimizeContainer(c, changes, label, options.resourceHint, options.basedOnHistory);
      if (result?.suggestion) suggestions.push(result.suggestion);

      const pvcDoc = addStatefulStorage(doc, podSpec, c, changes);
      if (pvcDoc) extraDocs.push(pvcDoc);
    });

    if (doc.kind === 'Deployment' || doc.kind === 'Pod') {
      const netpolDoc = generateNetworkPolicy(doc, containers, changes);
      if (netpolDoc) extraDocs.push(netpolDoc);
    }
  });

  const allDocs = [...docs, ...extraDocs];
  const optimized = allDocs.map((d) => yaml.dump(d)).join('---\n');
  return { optimized, changes, suggestions };
}

module.exports = { optimizeK8sManifest };
