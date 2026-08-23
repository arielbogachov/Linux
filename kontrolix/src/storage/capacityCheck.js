const { execSync } = require('child_process');
const { getK8sStorageStatus, parseK8sQuantity } = require('./k8sStorage');

function getHostFreeBytes() {
  try {
    const out = execSync('df -kP .', { encoding: 'utf8' });
    const parts = out.trim().split('\n')[1].trim().split(/\s+/);
    const availableKb = parseInt(parts[3], 10); // "Available" column, in 1K blocks
    return availableKb * 1024;
  } catch {
    return null; // unavailable on this platform — caller should treat as "unknown, don't block"
  }
}

/**
 * Checks whether a new PersistentVolumeClaim of the given size would actually
 * fit before it gets applied — this is the "control it before adding, not
 * always, only when needed" behavior: it only blocks when there's a real,
 * measurable shortfall, and it never silently shrinks or skips the request.
 *
 * @param {number} requiredBytes
 * @param {string} [namespace]
 * @returns {{ fits: boolean, checked: boolean, reason: string, freeBytes?: number, nodeAllocatableBytes?: number }}
 */
async function canFitNewStorage(requiredBytes) {
  const k8sStatus = await getK8sStorageStatus();

  if (k8sStatus.reachable && k8sStatus.nodes.length) {
    // Sum of already-requested PVC capacity + the new request, compared against
    // total allocatable ephemeral storage across nodes. This is approximate —
    // real scheduling also depends on which node — but it catches the common
    // case of "the cluster is basically full" before you find out at apply time.
    const totalAllocatable = k8sStatus.nodes.reduce((sum, n) => sum + (n.allocatableEphemeralBytes || 0), 0);
    const totalRequestedByExistingPvcs = k8sStatus.pvcs.reduce((sum, p) => sum + (p.capacityBytes || 0), 0);

    if (totalAllocatable > 0) {
      const projected = totalRequestedByExistingPvcs + requiredBytes;
      if (projected > totalAllocatable) {
        return {
          fits: false,
          checked: true,
          reason: `Cluster nodes report ~${(totalAllocatable / 1024 / 1024 / 1024).toFixed(1)} GiB allocatable ephemeral storage total; existing PVCs already claim ~${(totalRequestedByExistingPvcs / 1024 / 1024 / 1024).toFixed(1)} GiB, and this new PVC needs ${(requiredBytes / 1024 / 1024 / 1024).toFixed(2)} GiB more than that leaves.`,
          nodeAllocatableBytes: totalAllocatable,
        };
      }
      return { fits: true, checked: true, reason: 'Fits within cluster allocatable ephemeral storage.', nodeAllocatableBytes: totalAllocatable };
    }
  }

  // No reachable cluster (or no ephemeral-storage reporting) — fall back to
  // checking the host Kontrolix itself is running on, so at least a local
  // kind/minikube setup still gets a real check.
  const freeBytes = getHostFreeBytes();
  if (freeBytes === null) {
    return { fits: true, checked: false, reason: 'Could not determine available capacity on this platform — proceeding without a capacity check.' };
  }
  if (requiredBytes > freeBytes) {
    return {
      fits: false,
      checked: true,
      reason: `Only ${(freeBytes / 1024 / 1024 / 1024).toFixed(2)} GiB free on the host Kontrolix is running on, but this needs ${(requiredBytes / 1024 / 1024 / 1024).toFixed(2)} GiB.`,
      freeBytes,
    };
  }
  return { fits: true, checked: true, reason: 'Fits within free host disk space.', freeBytes };
}

module.exports = { canFitNewStorage, getHostFreeBytes };
