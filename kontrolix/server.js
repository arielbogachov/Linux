const express = require('express');
const path = require('path');

const apiRoutes = require('./src/routes/api');
const webhookRoutes = require('./src/routes/webhook');
const optimizeRoutes = require('./src/routes/optimize');
const insightsRoutes = require('./src/routes/insights');
const storageRoutes = require('./src/routes/storage');
const generateRoutes = require('./src/routes/generate');
const { initScheduler } = require('./src/scheduler');
const { initDiskGuard } = require('./src/storage/diskGuard');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRoutes);
app.use('/api/optimize', optimizeRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/generate', generateRoutes);
app.use('/webhook', webhookRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initScheduler();
initDiskGuard();

app.listen(PORT, () => {
  console.log(`\n  Kontrolix running at http://localhost:${PORT}\n`);
});
