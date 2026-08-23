const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const k8s = require('@kubernetes/client-node');
const { canFitNewStorage } = require('../../storage/capacityCheck');
const { parseK8sQuantity } = require('../../storage/k8sStorage');

/**
 * step config: {
 *   type: 'k8sDeploy',
 *   manifestPath: './k8s/myapp-deployment.yaml',  // single file...
 *   manifestDir: './k8s',                          // ...or a whole dir (uses ctx.vars.k8sManifestDir if omitted)
 *   namespace: 'default',
 *   skipCapacityCheck: false   // set true to bypass the pre-flight PVC capacity check below
 * }
 *
 * Applies manifests using a create-or-replace strategy (kubectl apply equivalent).
 * Before applying any PersistentVolumeClaim, this checks real cluster/host
 * capacity first — smart, not blind: it only stops you when there's an actual
 * measurable shortfall, and every other manifest kind deploys with no check at all.
 */
async function applyManifest(kc, doc, namespace, ctx) {
  const objectApi = kc.makeApiClient(k8s.KubernetesObjectApi);
  doc.metadata = doc.metadata || {};
  doc.metadata.namespace = doc.metadata.namespace || namespace;

  try {
    await objectApi.read({
      apiVersion: doc.apiVersion,
      kind: doc.kind,
      metadata: doc.metadata,
    });
    const result = await objectApi.patch(doc);
    ctx.log(`Patched ${doc.kind}/${doc.metadata.name}`, 'step');
    return result;
  } catch (err) {
    // Not found -> create
    const result = await objectApi.create(doc);
    ctx.log(`Created ${doc.kind}/${doc.metadata.name}`, 'step');
    return result;
  }
}

async function run(step, ctx) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault(); // uses ~/.kube/config or in-cluster config

  const namespace = step.namespace || 'default';

  let files = [];
  if (step.manifestPath) {
    files = [step.manifestPath];
  } else if (step.manifestDir) {
    files = fs.readdirSync(step.manifestDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => path.join(step.manifestDir, f));
  } else if (ctx.vars.k8sManifestFiles) {
    files = ctx.vars.k8sManifestFiles;
  } else {
    throw new Error('k8sDeploy step requires "manifestPath", "manifestDir", or a prior composeConvert step');
  }

  ctx.log(`Deploying ${files.length} manifest(s) to namespace "${namespace}"`, 'step');

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const docs = yaml.loadAll(raw).filter(Boolean);

    for (const doc of docs) {
      if (doc.kind === 'PersistentVolumeClaim' && !step.skipCapacityCheck) {
        const requestedBytes = parseK8sQuantity(doc.spec?.resources?.requests?.storage) || 0;
        const capacity = await canFitNewStorage(requestedBytes);

        if (!capacity.checked) {
          ctx.log(`Capacity check skipped for PVC "${doc.metadata?.name}": ${capacity.reason}`, 'step');
        } else if (!capacity.fits) {
          throw new Error(`Refusing to create PersistentVolumeClaim "${doc.metadata?.name}": ${capacity.reason} Set "skipCapacityCheck": true on this step to force it anyway, or free up space first.`);
        } else {
          ctx.log(`Capacity check passed for PVC "${doc.metadata?.name}": ${capacity.reason}`, 'step');
        }
      }

      await applyManifest(kc, doc, namespace, ctx);
    }
  }

  ctx.log('Kubernetes deploy complete', 'step');
}

module.exports = { run };
