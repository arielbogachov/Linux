const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const k8s = require('@kubernetes/client-node');

/**
 * step config: {
 *   type: 'k8sDeploy',
 *   manifestPath: './k8s/myapp-deployment.yaml',  // single file...
 *   manifestDir: './k8s',                          // ...or a whole dir (uses ctx.vars.k8sManifestDir if omitted)
 *   namespace: 'default'
 * }
 *
 * Applies manifests using a create-or-replace strategy (kubectl apply equivalent).
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
      await applyManifest(kc, doc, namespace, ctx);
    }
  }

  ctx.log('Kubernetes deploy complete', 'step');
}

module.exports = { run };
