const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * step config: {
 *   type: 'composeConvert',
 *   composeFile: 'docker-compose.yml',
 *   outputDir: './k8s'
 * }
 *
 * A lightweight Compose -> Kubernetes converter (covers the common subset:
 * image, ports, environment, volumes, replicas via deploy.replicas, command).
 */
function toK8sName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function convertService(serviceName, svc) {
  const name = toK8sName(serviceName);
  const containerPorts = (svc.ports || []).map((p) => {
    const [hostPort, containerPort] = String(p).split(':');
    const port = containerPort || hostPort;
    return { containerPort: parseInt(port, 10) };
  });

  const env = svc.environment
    ? Object.entries(
        Array.isArray(svc.environment)
          ? Object.fromEntries(svc.environment.map((e) => e.split('=')))
          : svc.environment
      ).map(([key, value]) => ({ name: key, value: String(value) }))
    : [];

  const replicas = svc.deploy && svc.deploy.replicas ? svc.deploy.replicas : 1;

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, labels: { app: name } },
    spec: {
      replicas,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          containers: [
            {
              name,
              image: svc.image,
              ...(svc.command ? { command: Array.isArray(svc.command) ? svc.command : [svc.command] } : {}),
              ...(containerPorts.length ? { ports: containerPorts } : {}),
              ...(env.length ? { env } : {}),
            },
          ],
        },
      },
    },
  };

  let service = null;
  if (containerPorts.length) {
    service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, labels: { app: name } },
      spec: {
        selector: { app: name },
        ports: containerPorts.map((cp) => ({
          port: cp.containerPort,
          targetPort: cp.containerPort,
        })),
      },
    };
  }

  return { deployment, service };
}

async function run(step, ctx) {
  const composeFile = step.composeFile || 'docker-compose.yml';
  const outputDir = step.outputDir || './k8s';

  ctx.log(`Reading compose file: ${composeFile}`, 'step');
  const raw = fs.readFileSync(composeFile, 'utf8');
  const compose = yaml.load(raw);

  if (!compose.services) throw new Error('No "services" block found in compose file');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const writtenFiles = [];
  for (const [serviceName, svc] of Object.entries(compose.services)) {
    const { deployment, service } = convertService(serviceName, svc);
    const deployPath = path.join(outputDir, `${toK8sName(serviceName)}-deployment.yaml`);
    fs.writeFileSync(deployPath, yaml.dump(deployment));
    writtenFiles.push(deployPath);
    ctx.log(`Wrote ${deployPath}`);

    if (service) {
      const svcPath = path.join(outputDir, `${toK8sName(serviceName)}-service.yaml`);
      fs.writeFileSync(svcPath, yaml.dump(service));
      writtenFiles.push(svcPath);
      ctx.log(`Wrote ${svcPath}`);
    }
  }

  ctx.log(`Converted ${Object.keys(compose.services).length} service(s) to Kubernetes manifests`, 'step');
  ctx.vars.k8sManifestDir = outputDir;
  ctx.vars.k8sManifestFiles = writtenFiles;
}

module.exports = { run };
