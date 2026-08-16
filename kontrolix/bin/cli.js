#!/usr/bin/env node
const { Command } = require('commander');
const fs = require('fs');

const BASE_URL = process.env.KONTROLIX_URL || 'http://localhost:8080';

async function api(pathName, options = {}) {
  const res = await fetch(`${BASE_URL}${pathName}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  return data;
}

const program = new Command();
program.name('kontrolix').description('CLI for the Kontrolix server (Docker + Kubernetes pipelines)');

program
  .command('list')
  .description('List all jobs')
  .action(async () => {
    const jobs = await api('/api/jobs');
    if (jobs.length === 0) return console.log('No jobs yet. Create one with `kontrolix create <file.json>`');
    jobs.forEach((j) => {
      console.log(`${j.name}\t[${j.trigger_type}]\t${j.steps.length} step(s)\t${j.description || ''}`);
    });
  });

program
  .command('create <file>')
  .description('Create a job from a JSON definition file')
  .action(async (file) => {
    const def = JSON.parse(fs.readFileSync(file, 'utf8'));
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify(def) });
    console.log(`Created job "${job.name}" (id: ${job.id})`);
  });

program
  .command('run <name>')
  .description('Trigger a job run by name')
  .action(async (name) => {
    const jobs = await api('/api/jobs');
    const job = jobs.find((j) => j.name === name);
    if (!job) return console.error(`Job "${name}" not found`);

    const { runId } = await api(`/api/jobs/${job.id}/run`, { method: 'POST' });
    console.log(`Started run ${runId} for job "${name}"`);
    console.log(`Tail logs with: kontrolix logs ${runId}`);
  });

program
  .command('logs <runId>')
  .description('Show logs for a run')
  .option('-f, --follow', 'Follow logs until the run finishes')
  .action(async (runId, opts) => {
    let seen = 0;
    while (true) {
      const logs = await api(`/api/runs/${runId}/logs`);
      logs.slice(seen).forEach((l) => {
        const tag = l.level === 'error' ? 'ERROR' : l.level === 'step' ? 'STEP ' : 'INFO ';
        console.log(`[${tag}] ${l.message}`);
      });
      seen = logs.length;

      if (!opts.follow) break;

      const run = await api(`/api/runs/${runId}`);
      if (run.status !== 'running' && run.status !== 'pending') {
        console.log(`\nRun finished with status: ${run.status}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  });

program
  .command('status <runId>')
  .description('Show the status of a run')
  .action(async (runId) => {
    const run = await api(`/api/runs/${runId}`);
    console.log(`status: ${run.status}`);
    console.log(`started: ${run.started_at}`);
    console.log(`finished: ${run.finished_at || '-'}`);
  });

program
  .command('runs [jobName]')
  .description('List recent runs (optionally filtered by job name)')
  .action(async (jobName) => {
    let runs = await api('/api/runs');
    if (jobName) runs = runs.filter((r) => r.job_name === jobName);
    runs.forEach((r) => {
      console.log(`${r.id}\t${r.job_name}\t${r.status}\t${r.started_at}`);
    });
  });

program
  .command('delete <name>')
  .description('Delete a job by name')
  .action(async (name) => {
    const jobs = await api('/api/jobs');
    const job = jobs.find((j) => j.name === name);
    if (!job) return console.error(`Job "${name}" not found`);
    await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
    console.log(`Deleted job "${name}"`);
  });

program
  .command('optimize <file>')
  .description('Optimize a K8s manifest, docker-compose.yml, or Dockerfile in one click')
  .option('-t, --type <type>', 'k8s | compose | dockerfile (auto-detected from filename if omitted)')
  .option('-a, --apply', 'write the optimized file to ./optimized-output on the server instead of just previewing')
  .option('-o, --out <path>', 'save the optimized content locally instead of printing it')
  .action(async (file, opts) => {
    const content = fs.readFileSync(file, 'utf8');
    const type = opts.type || detectType(file);

    if (opts.apply) {
      const result = await api('/api/optimize/apply', {
        method: 'POST',
        body: JSON.stringify({ type, content, filename: file.split(/[\\/]/).pop() }),
      });
      console.log(`Applied — written to ${result.path} on the server.`);
      result.changes.forEach((c) => console.log(`  + ${c}`));
      return;
    }

    const result = await api('/api/optimize', { method: 'POST', body: JSON.stringify({ type, content }) });
    console.log(`\n${result.changes.length} change(s):`);
    result.changes.forEach((c) => console.log(`  + ${c}`));
    if (result.suggestions.length) {
      console.log(`\n${result.suggestions.length} suggestion(s) (not auto-applied):`);
      result.suggestions.forEach((s) => console.log(`  ? ${s}`));
    }

    if (opts.out) {
      fs.writeFileSync(opts.out, result.optimized);
      console.log(`\nOptimized file written to ${opts.out}`);
    } else {
      console.log(`\n--- optimized ---\n${result.optimized}`);
    }
  });

function detectType(file) {
  const lower = file.toLowerCase();
  if (lower.includes('dockerfile')) return 'dockerfile';
  if (lower.includes('compose')) return 'compose';
  return 'k8s';
}

program.parse();
