const Docker = require('dockerode');

/**
 * Full breakdown of what Docker is actually using disk for — this is "look at
 * the containers/images, not my PC's C: drive". Docker's own `df` command
 * reports this; we call the same API endpoint dockerode wraps.
 *
 * @returns {{
 *   reachable: boolean,
 *   images: { count, totalBytes, reclaimableBytes },
 *   containers: { count, totalBytes, runningCount, stoppedCount },
 *   volumes: { count, totalBytes },
 *   buildCache: { count, totalBytes },
 * } | { reachable: false }}
 */
async function getDockerStorageBreakdown() {
  try {
    const docker = new Docker();
    const df = await docker.df();

    const images = df.Images || [];
    const danglingImages = images.filter((i) => i.RepoTags?.length === 0 || i.RepoTags?.[0] === '<none>:<none>');
    const imagesTotalBytes = images.reduce((sum, i) => sum + (i.Size || 0), 0);
    const imagesReclaimable = danglingImages.reduce((sum, i) => sum + (i.Size || 0), 0);

    const containers = df.Containers || [];
    const running = containers.filter((c) => c.State === 'running');
    const stopped = containers.filter((c) => c.State !== 'running');
    const containersTotalBytes = containers.reduce((sum, c) => sum + (c.SizeRw || 0), 0);

    const volumes = df.Volumes || [];
    const volumesTotalBytes = volumes.reduce((sum, v) => sum + (v.UsageData?.Size > 0 ? v.UsageData.Size : 0), 0);

    const buildCache = df.BuildCache || [];
    const buildCacheTotalBytes = buildCache.reduce((sum, b) => sum + (b.Size || 0), 0);

    return {
      reachable: true,
      images: { count: images.length, totalBytes: imagesTotalBytes, reclaimableBytes: imagesReclaimable },
      containers: { count: containers.length, totalBytes: containersTotalBytes, runningCount: running.length, stoppedCount: stopped.length },
      volumes: { count: volumes.length, totalBytes: volumesTotalBytes },
      buildCache: { count: buildCache.length, totalBytes: buildCacheTotalBytes },
    };
  } catch {
    return { reachable: false };
  }
}

module.exports = { getDockerStorageBreakdown };
