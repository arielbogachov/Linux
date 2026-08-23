const CATEGORIES = {
  security: { icon: '🔒', label: 'Security' },
  performance: { icon: '⚡', label: 'Performance' },
  reliability: { icon: '🩺', label: 'Reliability' },
  storage: { icon: '🗄', label: 'Storage' },
  general: { icon: 'ℹ️', label: 'General' },
};

function tag(category, message) {
  if (!CATEGORIES[category]) category = 'general';
  return { category, message };
}

module.exports = { tag, CATEGORIES };
