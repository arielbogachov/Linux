const express = require('express');
const diskGuard = require('../storage/diskGuard');
const { getDockerStorageBreakdown } = require('../storage/dockerStorage');
const { getK8sStorageStatus } = require('../storage/k8sStorage');

const router = express.Router();

router.get('/status', async (req, res) => {
  const [dockerBreakdown, k8sStatus] = await Promise.all([
    getDockerStorageBreakdown(),
    getK8sStorageStatus(),
  ]);
  res.json({ ...diskGuard.getStatus(), dockerBreakdown, k8s: k8sStatus });
});

router.post('/check', async (req, res) => {
  await diskGuard.evaluate();
  res.json(diskGuard.getStatus());
});

router.post('/prune', async (req, res) => {
  try {
    const result = await diskGuard.approvePrune();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
