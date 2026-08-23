const k8s = require('@kubernetes/client-node');

function parseK8sQuantity(qty) {
  // Parses things like "100Gi", "500Mi", "2Ti", "1500000000" into bytes.
  if (qty === undefined || qty === null) return null;
  const str = String(qty);
  const units = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  const m = str.match(/^([\d.]+)([A-Za-z]*)$/);
  if (!m) return null;
  const [, num, unit] = m;
  const multiplier = units[unit] || 1;
  return Math.round(parseFloat(num) * multiplier);
}

/**
 * @returns {{
 *   reachable: boolean,
 *   nodes: { name, allocatableEphemeralBytes, capacityEphemeralBytes }[],
 *   pvcs: { namespace, name, capacityBytes, phase, storageClassName }[],
 * } | { reachable: false }}
 */
async function getK8sStorageStatus() {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const [nodesRes, pvcsRes] = await Promise.all([
      coreApi.listNode(),
      coreApi.listPersistentVolumeClaimForAllNamespaces(),
    ]);

    const nodeItems = nodesRes.body?.items || nodesRes.items || [];
    const pvcItems = pvcsRes.body?.items || pvcsRes.items || [];

    const nodes = nodeItems.map((n) => ({
      name: n.metadata?.name,
      allocatableEphemeralBytes: parseK8sQuantity(n.status?.allocatable?.['ephemeral-storage']),
      capacityEphemeralBytes: parseK8sQuantity(n.status?.capacity?.['ephemeral-storage']),
    }));

    const pvcs = pvcItems.map((p) => ({
      namespace: p.metadata?.namespace,
      name: p.metadata?.name,
      capacityBytes: parseK8sQuantity(p.status?.capacity?.storage || p.spec?.resources?.requests?.storage),
      phase: p.status?.phase,
      storageClassName: p.spec?.storageClassName,
    }));

    return { reachable: true, nodes, pvcs };
  } catch {
    return { reachable: false, nodes: [], pvcs: [] }; // no kubeconfig / cluster unreachable — fine, just means this section is empty
  }
}

module.exports = { getK8sStorageStatus, parseK8sQuantity };
