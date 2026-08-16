const express = require('express');
const path = require('path');

const apiRoutes = require('./src/routes/api');
const webhookRoutes = require('./src/routes/webhook');
const optimizeRoutes = require('./src/routes/optimize');
const { initScheduler } = require('./src/scheduler');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRoutes);
app.use('/api/optimize', optimizeRoutes);
app.use('/webhook', webhookRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initScheduler();

app.listen(PORT, () => {
  console.log(`\n  Kontrolix running at http://localhost:${PORT}\n`);
});
