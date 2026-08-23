const { execSync } = require('child_process');
const cron = require('node-cron');
const Docker = require('dockerode');

const WARN_PERCENT = parseInt(process.env.DISK_WARN_PERCENT || '85', 10);
const CHECK_SCHEDULE = process.env.DISK_CHECK_SCHEDULE || '*/15 * * * *'; // every 15 min

let state = {
  lastCheckedAt: null,
  diskUsagePercent: null,       // null if unavailable on this platform
  dockerReclaimableBytes: null,
  pending: null,                // { id, createdAt, diskUsagePercent, reclaimableBytes, reason }
  history: [],                  // recent prune actions / auto-clears, most recent first
};

function getDiskUsagePercent() {
  try {
    // `df -kP .` works on Linux/macOS; not meaningful in Git Bash on Windows, so
    // this fails soft there and the UI shows "unavailable on this platform".
    const out = execSync('df -kP .', { encoding: 'utf8' });
    const line = out.trim().split('\n')[1];
    const parts = line.trim().split(/\s+/);
    const usePercentStr = parts[4]; // e.g. "42%"
    return parseInt(usePercentStr.replace('%', ''), 10);
  } catch {
    return null;
  }
}

async function getDockerReclaimable() {
  try {
    const docker = new Docker();
    const df = await docker.df();
    const danglingImages = (df.Images || []).filter((img) => img.RepoTags?.length === 0 || img.RepoTags?.[0] === '<none>:<none>');
    const stoppedContainers = (df.Containers || []).filter((c) => c.State !== 'running');

    const imageBytes = danglingImages.reduce((sum, i) => sum + (i.Size || 0), 0);
    const containerBytes = stoppedContainers.reduce((sum, c) => sum + (c.SizeRw || 0), 0);

    return { totalBytes: imageBytes + containerBytes, danglingImageCount: danglingImages.length, stoppedContainerCount: stoppedContainers.length };
  } catch {
    return null; // Docker not reachable — fine, just means we can't estimate reclaimable space
  }
}

async function evaluate() {
  state.lastCheckedAt = new Date().toISOString();
  state.diskUsagePercent = getDiskUsagePercent();

  const reclaimable = await getDockerReclaimable();
  state.dockerReclaimableBytes = reclaimable?.totalBytes ?? null;

  const overThreshold = state.diskUsagePercent !== null && state.diskUsagePercent >= WARN_PERCENT;

  if (overThreshold && reclaimable && reclaimable.totalBytes > 0) {
    if (!state.pending) {
      state.pending = {
        id: Date.now().toString(36),
        createdAt: state.lastCheckedAt,
        diskUsagePercent: state.diskUsagePercent,
        reclaimableBytes: reclaimable.totalBytes,
        danglingImageCount: reclaimable.danglingImageCount,
        stoppedContainerCount: reclaimable.stoppedContainerCount,
        reason: `Disk usage at ${state.diskUsagePercent}% (≥ ${WARN_PERCENT}% threshold) — ${reclaimable.danglingImageCount} dangling image(s) and ${reclaimable.stoppedContainerCount} stopped container(s) could be pruned to reclaim ~${(reclaimable.totalBytes / 1024 / 1024).toFixed(0)} MiB`,
      };
    }
  } else if (state.pending && !overThreshold) {
    state.history.unshift({ at: state.lastCheckedAt, action: 'auto-cleared', detail: `Disk usage dropped back to ${state.diskUsagePercent}% before pruning was approved` });
    state.pending = null;
  }

  state.history = state.history.slice(0, 20);
}

async function approvePrune() {
  const docker = new Docker();
  const results = { imagesDeleted: 0, containersDeleted: 0, spaceReclaimedBytes: 0 };

  try {
    const imgResult = await docker.pruneImages({ filters: { dangling: { true: true } } });
    results.imagesDeleted = (imgResult.ImagesDeleted || []).length;
    results.spaceReclaimedBytes += imgResult.SpaceReclaimed || 0;
  } catch (err) {
    /* best effort — surfaced via the returned object, not thrown, so partial success still reports */
  }

  try {
    const containerResult = await docker.pruneContainers();
    results.containersDeleted = (containerResult.ContainersDeleted || []).length;
    results.spaceReclaimedBytes += containerResult.SpaceReclaimed || 0;
  } catch (err) {
    /* best effort */
  }

  state.history.unshift({
    at: new Date().toISOString(),
    action: 'pruned',
    detail: `Removed ${results.imagesDeleted} image(s) and ${results.containersDeleted} container(s), reclaimed ~${(results.spaceReclaimedBytes / 1024 / 1024).toFixed(0)} MiB`,
  });
  state.pending = null;

  return results;
}

function getStatus() {
  return {
    lastCheckedAt: state.lastCheckedAt,
    diskUsagePercent: state.diskUsagePercent,
    warnThresholdPercent: WARN_PERCENT,
    dockerReclaimableBytes: state.dockerReclaimableBytes,
    pending: state.pending,
    history: state.history,
  };
}

function initDiskGuard() {
  evaluate().catch(() => {});
  cron.schedule(CHECK_SCHEDULE, () => evaluate().catch(() => {}));
  console.log(`[disk-guard] Watching disk usage every "${CHECK_SCHEDULE}" (warn at ${WARN_PERCENT}%) — will only recommend pruning, never acts without approval`);
}

module.exports = { initDiskGuard, evaluate, approvePrune, getStatus };
