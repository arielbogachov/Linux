const API = '/api';
let currentSteps = [];
let logPollTimer = null;

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function statusDotClass(status) {
  return { success: 'dot-success', running: 'dot-running', failed: 'dot-failed', pending: 'dot-pending' }[status] || 'dot-idle';
}
function statusBadgeClass(status) {
  return { success: 'badge-success', running: 'badge-running', failed: 'badge-failed', pending: 'badge-pending' }[status] || '';
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
  document.getElementById(`view-${name}`).hidden = false;
  document.querySelectorAll('.rail-link').forEach((l) => l.classList.remove('active'));
  const navBtn = document.querySelector(`.rail-link[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (logPollTimer && name !== 'run-logs') { clearInterval(logPollTimer); logPollTimer = null; }
}

// ---------- Jobs list ----------
async function renderJobsList() {
  const jobs = await api('/jobs');
  const el = document.getElementById('jobs-list');
  if (jobs.length === 0) {
    el.innerHTML = `<div class="empty">No pipelines yet. Create one to build, convert, and deploy across Docker &amp; Kubernetes.</div>`;
    return;
  }
  el.innerHTML = jobs.map((j) => `
    <div class="card-row" data-job-id="${j.id}">
      <div class="card-row-main">
        <span class="card-row-name">${escapeHtml(j.name)}</span>
        <span class="card-row-meta">${escapeHtml(j.description || '')} · ${j.steps.length} step(s) · trigger: ${j.trigger_type}</span>
      </div>
      <div class="card-row-right">
        <button class="btn btn-sm btn-primary" data-run-job="${j.id}">▶ Run</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-job-id]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-run-job]')) return;
      openJobDetail(row.dataset.jobId);
    });
  });
  el.querySelectorAll('[data-run-job]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { runId } = await api(`/jobs/${btn.dataset.runJob}/run`, { method: 'POST' });
      openRunLogs(runId);
    });
  });
}

// ---------- Job detail ----------
async function openJobDetail(jobId) {
  const job = await api(`/jobs/${jobId}`);
  const runs = await api(`/jobs/${jobId}/runs`);
  renderInsights(jobId);

  document.getElementById('job-detail-name').textContent = job.name;
  document.getElementById('job-detail-desc').textContent = job.description || '';

  document.getElementById('job-detail-steps').innerHTML = job.steps.map((s) => `
    <div class="chain-link">
      <div class="chain-link-type">${labelForStepType(s.type)}</div>
      <div class="chain-link-detail">${escapeHtml(stepSummary(s))}</div>
    </div>
  `).join('');

  const runsEl = document.getElementById('job-detail-runs');
  runsEl.innerHTML = runs.length ? runs.map((r) => runRowHtml(r)).join('') : `<div class="empty">No runs yet.</div>`;
  runsEl.querySelectorAll('[data-run-id]').forEach((row) => {
    row.addEventListener('click', () => openRunLogs(row.dataset.runId));
  });

  document.getElementById('run-job-btn').onclick = async () => {
    const { runId } = await api(`/jobs/${jobId}/run`, { method: 'POST' });
    openRunLogs(runId);
  };
  document.getElementById('delete-job-btn').onclick = async () => {
    if (!confirm(`Delete job "${job.name}"? This also removes its run history.`)) return;
    await api(`/jobs/${jobId}`, { method: 'DELETE' });
    showView('jobs');
    renderJobsList();
  };

  showView('job-detail');
}

async function renderInsights(jobId) {
  const panel = document.getElementById('job-detail-insights');
  const body = document.getElementById('job-detail-insights-body');
  try {
    const insights = await api(`/insights/${jobId}`);
    if (insights.sampleCount === 0) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const r = insights.recommendedResources;
    let html = `<div class="insight-row">
      <div class="insight-stat"><span class="insight-stat-label">Samples</span><span class="insight-stat-value">${insights.sampleCount} dev-check run(s)</span></div>
      <div class="insight-stat"><span class="insight-stat-label">Recommended requests</span><span class="insight-stat-value mono">${r.requests.cpu} / ${r.requests.memory}</span></div>
      <div class="insight-stat"><span class="insight-stat-label">Recommended limits</span><span class="insight-stat-value mono">${r.limits.cpu} / ${r.limits.memory}</span></div>
      <div class="insight-stat"><span class="insight-stat-label">Sizing basis</span><span class="insight-stat-value">${insights.basedOnHistory ? 'real usage ✓' : 'static default'}</span></div>
    </div>`;

    if (insights.recurringFailures.length) {
      html += `<div style="margin-top:8px;">${insights.recurringFailures.map((f) => `
        <div class="failure-pattern"><span class="failure-pattern-count">${f.count}×</span>${escapeHtml(f.signature)} <span class="muted">(last seen ${f.lastSeen})</span></div>
      `).join('')}</div>`;
    }

    body.innerHTML = html;
  } catch {
    panel.hidden = true;
  }
}

function runRowHtml(r) {
  return `
    <div class="card-row" data-run-id="${r.id}">
      <div class="card-row-main">
        <span class="card-row-name mono">${r.id.slice(0, 8)}</span>
        <span class="card-row-meta">${r.started_at || ''} · trigger: ${r.trigger_source}</span>
      </div>
      <div class="card-row-right">
        <span class="dot ${statusDotClass(r.status)}"></span>
        <span class="badge ${statusBadgeClass(r.status)}">${r.status}</span>
      </div>
    </div>`;
}

// ---------- All runs ----------
async function renderRunsList() {
  const runs = await api('/runs');
  const el = document.getElementById('runs-list');
  el.innerHTML = runs.length ? runs.map((r) => `
    <div class="card-row" data-run-id="${r.id}">
      <div class="card-row-main">
        <span class="card-row-name">${escapeHtml(r.job_name)}</span>
        <span class="card-row-meta mono">${r.id.slice(0, 8)} · ${r.started_at || ''} · trigger: ${r.trigger_source}</span>
      </div>
      <div class="card-row-right">
        <span class="dot ${statusDotClass(r.status)}"></span>
        <span class="badge ${statusBadgeClass(r.status)}">${r.status}</span>
      </div>
    </div>`).join('') : `<div class="empty">No runs yet.</div>`;

  el.querySelectorAll('[data-run-id]').forEach((row) => {
    row.addEventListener('click', () => openRunLogs(row.dataset.runId));
  });
}

// ---------- Run logs ----------
async function openRunLogs(runId) {
  showView('run-logs');
  document.getElementById('run-log-id').textContent = runId.slice(0, 8);
  const out = document.getElementById('run-log-output');
  out.textContent = '';

  let seen = 0;
  async function poll() {
    const run = await api(`/runs/${runId}`);
    const badge = document.getElementById('run-log-status');
    badge.textContent = run.status;
    badge.className = `badge ${statusBadgeClass(run.status)}`;

    const logs = await api(`/runs/${runId}/logs`);
    const newLines = logs.slice(seen);
    newLines.forEach((l) => {
      const span = document.createElement('div');
      span.className = `log-line-${l.level}`;
      span.textContent = `[${l.ts}] ${l.message}`;
      out.appendChild(span);
    });
    seen = logs.length;
    out.scrollTop = out.scrollHeight;

    if (run.status !== 'running' && run.status !== 'pending' && logPollTimer) {
      clearInterval(logPollTimer);
      logPollTimer = null;
    }
  }

  await poll();
  logPollTimer = setInterval(poll, 1200);
}

// ---------- New job form ----------
function labelForStepType(type) {
  return {
    dockerBuild: 'Docker Build',
    dockerPush: 'Docker Push',
    composeConvert: 'Compose → K8s',
    k8sDeploy: 'K8s Deploy',
    optimize: 'Optimize',
    devCheck: 'Dev Check',
    shell: 'Shell',
  }[type] || type;
}

function stepSummary(step) {
  switch (step.type) {
    case 'dockerBuild': return `tag=${step.tag || '?'} context=${step.context || '.'}`;
    case 'dockerPush': return `tag=${step.tag || '(from build step)'}`;
    case 'composeConvert': return `${step.composeFile || 'docker-compose.yml'} → ${step.outputDir || './k8s'}`;
    case 'k8sDeploy': return `ns=${step.namespace || 'default'} ${step.manifestDir || step.manifestPath || '(from convert step)'}`;
    case 'optimize': return `${step.target || '?'} ${step.inputPath || ''} → ${step.outputPath || '(auto)'}`;
    case 'devCheck': return `image=${step.image || '(from build step)'} port=${step.port || '-'} timeout=${step.startupTimeoutSeconds || 15}s`;
    case 'shell': return step.command || '';
    default: return '';
  }
}

function defaultFieldsForStepType(type) {
  switch (type) {
    case 'dockerBuild': return [['tag', 'myapp:latest'], ['context', '.'], ['dockerfile', 'Dockerfile']];
    case 'dockerPush': return [['tag', 'myapp:latest']];
    case 'composeConvert': return [['composeFile', 'docker-compose.yml'], ['outputDir', './k8s']];
    case 'k8sDeploy': return [['namespace', 'default'], ['manifestDir', './k8s']];
    case 'optimize': return [['target', 'k8s'], ['inputPath', './k8s/web-deployment.yaml'], ['outputPath', './k8s-optimized/web-deployment.yaml']];
    case 'devCheck': return [['port', '3000'], ['healthPath', '/'], ['startupTimeoutSeconds', '15']];
    case 'shell': return [['command', 'echo hello']];
    default: return [];
  }
}

function renderStepsEditor() {
  const el = document.getElementById('steps-list');
  el.innerHTML = currentSteps.map((step, i) => `
    <div class="step-row" data-index="${i}">
      <span class="step-row-index">${i + 1}</span>
      <span class="step-row-type">${labelForStepType(step.type)}</span>
      ${Object.keys(step).filter((k) => k !== 'type').map((key) => `
        <input data-key="${key}" value="${escapeHtml(String(step[key] ?? ''))}" placeholder="${key}" />
      `).join('')}
      <button type="button" class="btn btn-sm btn-danger" data-remove="${i}">✕</button>
    </div>
  `).join('');

  el.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.closest('.step-row').dataset.index, 10);
      currentSteps[idx][input.dataset.key] = input.value;
    });
  });
  el.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentSteps.splice(parseInt(btn.dataset.remove, 10), 1);
      renderStepsEditor();
    });
  });
}

function initNewJobForm() {
  const triggerSelect = document.getElementById('trigger-type');
  triggerSelect.addEventListener('change', () => {
    document.getElementById('cron-field').hidden = triggerSelect.value !== 'cron';
    document.getElementById('webhook-field').hidden = triggerSelect.value !== 'webhook';
  });

  document.getElementById('add-step-btn').addEventListener('click', () => {
    const type = document.getElementById('step-type-select').value;
    const step = { type };
    defaultFieldsForStepType(type).forEach(([k, v]) => (step[k] = v));
    currentSteps.push(step);
    renderStepsEditor();
  });

  document.getElementById('job-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const description = form.description.value.trim();
    const trigger_type = form.trigger_type.value;

    let trigger_config = null;
    if (trigger_type === 'cron') trigger_config = { schedule: form.cron_schedule.value.trim() };
    if (trigger_type === 'webhook') trigger_config = { secret: form.webhook_secret.value.trim() };

    if (currentSteps.length === 0) {
      alert('Add at least one pipeline step.');
      return;
    }

    // coerce numeric-looking fields left as strings is fine; steps stored as JSON as-is
    await api('/jobs', {
      method: 'POST',
      body: JSON.stringify({ name, description, steps: currentSteps, trigger_type, trigger_config }),
    });

    currentSteps = [];
    form.reset();
    renderStepsEditor();
    showView('jobs');
    renderJobsList();
  });
}

// ---------- Optimize ----------
let lastOptimizeResult = null;

async function populateOptimizeHistoryDropdown() {
  const select = document.getElementById('optimize-history-job');
  try {
    const jobs = await api('/jobs');
    select.innerHTML = '<option value="">— static defaults —</option>' +
      jobs.map((j) => `<option value="${j.id}">${escapeHtml(j.name)}</option>`).join('');
  } catch { /* leave the default option only */ }
}

function initOptimizeView() {
  const uploadBtn = document.getElementById('optimize-upload-btn');
  const fileInput = document.getElementById('optimize-file-input');
  const input = document.getElementById('optimize-input');
  const typeSelect = document.getElementById('optimize-type');
  const historyField = document.getElementById('optimize-history-field');

  const toggleHistoryField = () => { historyField.hidden = !(typeSelect.value === 'k8s' || typeSelect.value === 'compose'); };
  typeSelect.addEventListener('change', toggleHistoryField);
  toggleHistoryField();
  populateOptimizeHistoryDropdown();

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    input.value = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.includes('dockerfile')) typeSelect.value = 'dockerfile';
    else if (lower.includes('compose')) typeSelect.value = 'compose';
    else typeSelect.value = 'k8s';
  });

  document.getElementById('optimize-run-btn').addEventListener('click', async () => {
    const type = typeSelect.value;
    const content = input.value.trim();
    const jobId = document.getElementById('optimize-history-job').value || undefined;
    if (!content) { alert('Paste or upload a file first.'); return; }

    const btn = document.getElementById('optimize-run-btn');
    btn.disabled = true;
    btn.textContent = 'Optimizing…';
    try {
      const result = await api('/optimize', { method: 'POST', body: JSON.stringify({ type, content, jobId }) });
      lastOptimizeResult = { ...result, jobId };
      renderOptimizeResults(result);
    } catch (err) {
      alert(`Optimize failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Optimize (one click)';
    }
  });

  document.getElementById('optimize-download-btn').addEventListener('click', () => {
    if (!lastOptimizeResult) return;
    const blob = new Blob([lastOptimizeResult.optimized], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optimized-${lastOptimizeResult.type}${lastOptimizeResult.type === 'dockerfile' ? '' : '.yaml'}`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('optimize-apply-btn').addEventListener('click', async () => {
    if (!lastOptimizeResult) return;
    const btn = document.getElementById('optimize-apply-btn');
    btn.disabled = true;
    btn.textContent = 'Applying…';
    try {
      const res = await api('/optimize/apply', {
        method: 'POST',
        body: JSON.stringify({
          type: lastOptimizeResult.type,
          content: lastOptimizeResult.original,
          filename: `optimized-${lastOptimizeResult.type}${lastOptimizeResult.type === 'dockerfile' ? '' : '.yaml'}`,
          jobId: lastOptimizeResult.jobId,
        }),
      });
      alert(`Applied — written to ${res.path} on the server.`);
    } catch (err) {
      alert(`Apply failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Apply on server';
    }
  });
}

const CATEGORY_META = {
  security: { icon: '🔒', label: 'Security' },
  performance: { icon: '⚡', label: 'Performance' },
  reliability: { icon: '🩺', label: 'Reliability' },
  storage: { icon: '🗄', label: 'Storage' },
  general: { icon: 'ℹ️', label: 'General' },
};

function groupByCategory(entries) {
  const groups = {};
  entries.forEach((e) => {
    const cat = e.category || 'general';
    groups[cat] = groups[cat] || [];
    groups[cat].push(e.message || e);
  });
  return groups;
}

function renderGroupedList(entries, variant) {
  const groups = groupByCategory(entries);
  const order = ['security', 'reliability', 'storage', 'performance', 'general'];
  const listClass = variant === 'suggestion' ? 'change-list change-list-suggestion' : 'change-list';
  return order
    .filter((cat) => groups[cat]?.length)
    .map((cat) => {
      const meta = CATEGORY_META[cat];
      return `
        <div class="category-group">
          <div class="category-group-head">${meta.icon} ${meta.label} <span class="muted">(${groups[cat].length})</span></div>
          <ul class="${listClass}">${groups[cat].map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>
        </div>`;
    }).join('');
}

function renderOptimizeResults(result) {
  const panel = document.getElementById('optimize-results');
  panel.hidden = false;

  const securityCount = result.changes.filter((c) => c.category === 'security').length
    + result.suggestions.filter((s) => s.category === 'security').length;

  const changesEl = document.getElementById('optimize-changes');
  changesEl.innerHTML = result.changes.length
    ? renderGroupedList(result.changes, 'change')
    : '<div class="empty" style="padding:16px;">Nothing to change — this file already looks solid.</div>';

  const suggestionsHead = document.getElementById('optimize-suggestions-head');
  const suggestionsEl = document.getElementById('optimize-suggestions');
  if (result.suggestions.length) {
    suggestionsHead.hidden = false;
    suggestionsEl.innerHTML = renderGroupedList(result.suggestions, 'suggestion');
  } else {
    suggestionsHead.hidden = true;
    suggestionsEl.innerHTML = '';
  }

  document.getElementById('optimize-security-banner').hidden = securityCount === 0;
  document.getElementById('optimize-security-count').textContent = securityCount;

  const diffEl = document.getElementById('optimize-diff');
  diffEl.innerHTML = result.diff.map((part) => {
    const cls = part.added ? 'diff-line-added' : part.removed ? 'diff-line-removed' : 'diff-line-context';
    const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
    return part.value.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''))
      .map((line) => `<span class="${cls}">${prefix}${escapeHtml(line)}</span>`).join('\n');
  }).join('\n');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Generate Dockerfile ----------
let lastDetectedStack = null;
let lastGeneratedDockerfile = null;

function initGenerateView() {
  document.getElementById('generate-detect-btn').addEventListener('click', async () => {
    const fileInput = document.getElementById('generate-file-input');
    const rawFiles = Array.from(fileInput.files || []);
    if (rawFiles.length === 0) {
      alert('Upload at least one project file (package.json, requirements.txt, go.mod, pom.xml, or index.html).');
      return;
    }

    // Only read content for small text files that the detector actually inspects —
    // no need to read binaries or huge files just to check their name.
    const files = await Promise.all(rawFiles.map(async (f) => {
      const readable = /package\.json$/i.test(f.name) && f.size < 200_000;
      return { name: f.name, content: readable ? await f.text() : undefined };
    }));

    const btn = document.getElementById('generate-detect-btn');
    btn.disabled = true;
    btn.textContent = 'Detecting…';
    try {
      const detected = await api('/generate/detect', { method: 'POST', body: JSON.stringify({ files }) });
      lastDetectedStack = detected;

      document.getElementById('generate-confirm').hidden = false;
      document.getElementById('generate-result').hidden = true;
      document.getElementById('generate-detected-note').textContent =
        detected.stack === 'unknown'
          ? 'Couldn\'t auto-detect a stack from those files — pick one manually below.'
          : `Detected: ${detected.label} (${detected.confidence}). Adjust anything below before generating.`;
      document.getElementById('generate-stack').value = detected.stack === 'unknown' ? 'node' : detected.stack;
      document.getElementById('generate-port').value = detected.port;
      document.getElementById('generate-start-command').value = detected.startCommand || '';
      document.getElementById('generate-build-command').value = detected.buildCommand || '';
    } catch (err) {
      alert(`Detection failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Detect my stack';
    }
  });

  document.getElementById('generate-build-btn').addEventListener('click', async () => {
    const stack = document.getElementById('generate-stack').value;
    const port = parseInt(document.getElementById('generate-port').value, 10) || 3000;
    const startCommand = document.getElementById('generate-start-command').value.trim();
    const buildCommand = document.getElementById('generate-build-command').value.trim();

    const btn = document.getElementById('generate-build-btn');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const { dockerfile } = await api('/generate/dockerfile', {
        method: 'POST',
        body: JSON.stringify({ stack, port, startCommand: startCommand || undefined, buildCommand: buildCommand || undefined }),
      });
      lastGeneratedDockerfile = dockerfile;
      document.getElementById('generate-result').hidden = false;
      document.getElementById('generate-output').textContent = dockerfile;
    } catch (err) {
      alert(`Generate failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Dockerfile';
    }
  });

  document.getElementById('generate-download-btn').addEventListener('click', () => {
    if (!lastGeneratedDockerfile) return;
    const blob = new Blob([lastGeneratedDockerfile], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Dockerfile';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('generate-to-optimize-btn').addEventListener('click', () => {
    if (!lastGeneratedDockerfile) return;
    showView('optimize');
    document.getElementById('optimize-type').value = 'dockerfile';
    document.getElementById('optimize-type').dispatchEvent(new Event('change'));
    document.getElementById('optimize-input').value = lastGeneratedDockerfile;
  });
}

// ---------- Storage ----------
function bytesToHuman(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const mib = bytes / 1024 / 1024;
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${mib.toFixed(0)} MiB`;
}

async function renderStorageView() {
  try {
    const status = await api('/storage/status');
    renderStorageStatus(status);
  } catch (err) {
    document.getElementById('storage-gauge-label').textContent = `Couldn't load storage status: ${err.message}`;
  }
}

function renderStorageStatus(status) {
  const fill = document.getElementById('storage-gauge-fill');
  const label = document.getElementById('storage-gauge-label');

  if (status.diskUsagePercent === null) {
    fill.style.width = '0%';
    label.textContent = 'Disk usage unavailable on this platform — Docker reclaimable space still shown below when Docker is reachable.';
  } else {
    fill.style.width = `${status.diskUsagePercent}%`;
    fill.className = 'gauge-fill' + (status.diskUsagePercent >= status.warnThresholdPercent ? ' gauge-danger' : status.diskUsagePercent >= status.warnThresholdPercent - 10 ? ' gauge-warn' : '');
    label.textContent = `${status.diskUsagePercent}% used (warns at ${status.warnThresholdPercent}%) · Docker reclaimable: ${bytesToHuman(status.dockerReclaimableBytes)} · last checked ${status.lastCheckedAt || 'never'}`;
  }

  const pendingPanel = document.getElementById('storage-pending-panel');
  if (status.pending) {
    pendingPanel.hidden = false;
    document.getElementById('storage-pending-reason').textContent = status.pending.reason;
  } else {
    pendingPanel.hidden = true;
  }

  const historyEl = document.getElementById('storage-history');
  historyEl.innerHTML = status.history.length
    ? status.history.map((h) => `
      <div class="card-row" style="cursor:default;">
        <div class="card-row-main">
          <span class="card-row-name">${escapeHtml(h.action)}</span>
          <span class="card-row-meta">${escapeHtml(h.detail)} · ${h.at}</span>
        </div>
      </div>`).join('')
    : '<div class="empty">No prune activity yet.</div>';

  renderDockerBreakdown(status.dockerBreakdown);
  renderK8sBreakdown(status.k8s);
}

function renderDockerBreakdown(d) {
  const el = document.getElementById('storage-docker-breakdown');
  if (!d || !d.reachable) {
    el.innerHTML = '<div class="empty">Docker isn\'t reachable from the Kontrolix server right now.</div>';
    return;
  }
  el.innerHTML = `<div class="insight-row">
    <div class="insight-stat"><span class="insight-stat-label">Images</span><span class="insight-stat-value">${d.images.count} (${bytesToHuman(d.images.totalBytes)}, ${bytesToHuman(d.images.reclaimableBytes)} reclaimable)</span></div>
    <div class="insight-stat"><span class="insight-stat-label">Containers</span><span class="insight-stat-value">${d.containers.count} (${d.containers.runningCount} running, ${d.containers.stoppedCount} stopped)</span></div>
    <div class="insight-stat"><span class="insight-stat-label">Volumes</span><span class="insight-stat-value">${d.volumes.count} (${bytesToHuman(d.volumes.totalBytes)})</span></div>
    <div class="insight-stat"><span class="insight-stat-label">Build cache</span><span class="insight-stat-value">${bytesToHuman(d.buildCache.totalBytes)}</span></div>
  </div>`;
}

function renderK8sBreakdown(k) {
  const el = document.getElementById('storage-k8s-breakdown');
  if (!k || !k.reachable) {
    el.innerHTML = '<div class="empty">No reachable Kubernetes cluster (checked ~/.kube/config) — this section fills in once a cluster is configured.</div>';
    return;
  }
  const totalAllocatable = k.nodes.reduce((s, n) => s + (n.allocatableEphemeralBytes || 0), 0);
  const totalPvc = k.pvcs.reduce((s, p) => s + (p.capacityBytes || 0), 0);
  el.innerHTML = `
    <div class="insight-row">
      <div class="insight-stat"><span class="insight-stat-label">Nodes</span><span class="insight-stat-value">${k.nodes.length} (${bytesToHuman(totalAllocatable)} allocatable ephemeral storage)</span></div>
      <div class="insight-stat"><span class="insight-stat-label">PVCs</span><span class="insight-stat-value">${k.pvcs.length} (${bytesToHuman(totalPvc)} claimed)</span></div>
    </div>
    ${k.pvcs.length ? `<div class="stack">${k.pvcs.map((p) => `
      <div class="card-row" style="cursor:default;">
        <div class="card-row-main">
          <span class="card-row-name mono">${escapeHtml(p.namespace)}/${escapeHtml(p.name)}</span>
          <span class="card-row-meta">${bytesToHuman(p.capacityBytes)} · ${escapeHtml(p.storageClassName || 'default storage class')}</span>
        </div>
        <span class="badge ${p.phase === 'Bound' ? 'badge-success' : 'badge-pending'}">${escapeHtml(p.phase || 'unknown')}</span>
      </div>`).join('')}</div>` : ''}
  `;
}

function initStorageView() {
  document.getElementById('storage-check-btn').addEventListener('click', async () => {
    const btn = document.getElementById('storage-check-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const status = await api('/storage/check', { method: 'POST' });
      renderStorageStatus(status);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check now';
    }
  });

  document.getElementById('storage-prune-btn').addEventListener('click', async () => {
    if (!confirm('Prune dangling images and stopped containers now? This cannot be undone.')) return;
    const btn = document.getElementById('storage-prune-btn');
    btn.disabled = true;
    btn.textContent = 'Pruning…';
    try {
      await api('/storage/prune', { method: 'POST' });
      await renderStorageView();
    } catch (err) {
      alert(`Prune failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Approve — prune now';
    }
  });
}

// ---------- Nav wiring ----------
document.querySelectorAll('.rail-link[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    showView(view);
    if (view === 'jobs') renderJobsList();
    if (view === 'runs') renderRunsList();
    if (view === 'optimize') populateOptimizeHistoryDropdown();
    if (view === 'storage') renderStorageView();
  });
});
document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.goto));
});

async function checkServerStatus() {
  const el = document.getElementById('server-status');
  try {
    await api('/jobs');
    el.textContent = 'online';
  } catch {
    el.textContent = 'unreachable';
  }
}

// ---------- init ----------
initNewJobForm();
initOptimizeView();
initGenerateView();
initStorageView();
renderStepsEditor();
renderJobsList();
checkServerStatus();
setInterval(checkServerStatus, 10000);
