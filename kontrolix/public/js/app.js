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

function initOptimizeView() {
  const uploadBtn = document.getElementById('optimize-upload-btn');
  const fileInput = document.getElementById('optimize-file-input');
  const input = document.getElementById('optimize-input');
  const typeSelect = document.getElementById('optimize-type');

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
    if (!content) { alert('Paste or upload a file first.'); return; }

    const btn = document.getElementById('optimize-run-btn');
    btn.disabled = true;
    btn.textContent = 'Optimizing…';
    try {
      const result = await api('/optimize', { method: 'POST', body: JSON.stringify({ type, content }) });
      lastOptimizeResult = result;
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

function renderOptimizeResults(result) {
  const panel = document.getElementById('optimize-results');
  panel.hidden = false;

  const changesEl = document.getElementById('optimize-changes');
  changesEl.innerHTML = result.changes.length
    ? result.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')
    : '<li style="opacity:.6">Nothing to change — this file already looks solid.</li>';

  const suggestionsEl = document.getElementById('optimize-suggestions');
  suggestionsEl.innerHTML = (result.suggestions || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

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

// ---------- Nav wiring ----------
document.querySelectorAll('.rail-link[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    showView(view);
    if (view === 'jobs') renderJobsList();
    if (view === 'runs') renderRunsList();
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
renderStepsEditor();
renderJobsList();
checkServerStatus();
setInterval(checkServerStatus, 10000);
