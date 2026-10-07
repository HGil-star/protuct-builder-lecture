import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
const cwd = path.resolve(import.meta.dirname, '..');
async function start(t, configured = false) {
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const work = await mkdtemp(path.join(tmpdir(), 'dwg-server-test-'));
  const abandoned = path.join(work, 'a'.repeat(24)); await mkdir(abandoned); await writeFile(path.join(abandoned, 'input.zip'), 'abandoned');
  const args = configured ? ['--import', './test/mock-aps.js', 'server.js'] : ['server.js'];
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, PORT: String(port), DWG_WORK_DIR: work, APS_CLIENT_ID: configured ? 'test' : '', APS_CLIENT_SECRET: configured ? 'test' : '', APS_ACTIVITY_ID: configured ? 'test.DwgPdf+production' : '', PUBLIC_BASE_URL: 'https://fixture.example', FRONTEND_ORIGIN: 'https://site.example' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', c => { logs += c; });
  t.after(async () => { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); await rm(work, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/dwg/health')).ok) return { base, work }; } catch {} if (child.exitCode !== null) throw new Error(logs); await new Promise(r => setTimeout(r, 50)); }
  throw new Error('server failed to start: ' + logs);
}
async function waitState(base, job, state) {
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${base}/api/dwg/jobs/${job.id}`, { headers: { 'X-Job-Token': job.token } }); const data = await response.json();
    if (data.state === state) return data; if (data.state === 'failed') throw new Error(data.message);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('job timed out');
}
test('unconfigured server fails closed, hides secrets, blocks untrusted origins and cleans crash leftovers', async t => {
  const { base, work } = await start(t);
  assert.deepEqual(await readdir(work), []);
  const health = await (await fetch(base + '/api/dwg/health')).json(); assert.equal(health.ready, false);
  assert.equal((await fetch(base + '/api/dwg/jobs', { method: 'POST' })).status, 503);
  for (const route of ['/dwg-service/.env', '/.git/config', '/dwg-service/server.js']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base + '/api/dwg/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/dwg-pdf.html')).status, 200);
});
test('upload → analyze → reorder → merge → download → delete, with capability authorization and source cleanup', async t => {
  const { base, work } = await start(t, true);
  const form = new FormData(); form.append('reference', new Blob(['AC1032reference']), 'frame.dwg'); form.append('drawing', new Blob(['AC1032drawing']), 'plan.dwg'); form.append('paper', 'A3');
  const response = await fetch(base + '/api/dwg/jobs', { method: 'POST', body: form }); assert.equal(response.status, 202); const job = await response.json();
  const url = `${base}/api/dwg/jobs/${job.id}`, headers = { 'X-Job-Token': job.token };
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url + '/download')).status, 403);
  assert.equal((await fetch(base + '/api/dwg/transfer/unknown')).status, 403);
  const review = await waitState(base, job, 'review'); assert.deepEqual(review.frames.map(f => f.id), ['left', 'right']);
  assert.equal((await fetch(url + '/pages/left', { headers })).headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(url + '/generate', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['left', 'left'], paper: 'A3' }) })).status, 400);
  assert.equal((await fetch(url + '/generate', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['right', 'left'], paper: 'A1' }) })).status, 202);
  await waitState(base, job, 'done');
  const download = await fetch(url + '/download', { headers }); assert.equal(download.status, 200);
  const pdf = await PDFDocument.load(await download.arrayBuffer()); assert.equal(pdf.getPageCount(), 2); assert.deepEqual(pdf.getPages().map(p => p.getWidth()), [200, 100]);
  assert.equal((await readdir(path.join(work, job.id))).includes('input.zip'), false);
  assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 204);
  assert.deepEqual(await readdir(work), []);
  assert.equal((await fetch(url, { headers })).status, 410);
});
test('invalid upload is rejected and files are removed', async t => {
  const { base, work } = await start(t, true);
  const form = new FormData(); form.append('reference', new Blob(['not-a-dwg']), 'frame.dwg'); form.append('drawing', new Blob(['AC1032drawing']), 'plan.dwg');
  assert.equal((await fetch(base + '/api/dwg/jobs', { method: 'POST', body: form })).status, 400);
  assert.deepEqual(await readdir(work), []);
});
