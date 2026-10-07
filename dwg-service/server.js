import express from 'express';
import multer from 'multer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, rm, readdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PDFDocument } from 'pdf-lib';
import { configured, apsRequest } from './aps.js';
import { extractZip, makeZip, verifyDwg, readManifest } from './archive.js';
import { orderFrames, validateSelection } from './geometry.js';

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = path.resolve(process.env.DWG_WORK_DIR || path.join(tmpdir(), 'dwg-pdf-service'));
await mkdir(storage, { recursive: true, mode: 0o700 });
if ((await lstat(storage)).isSymbolicLink()) throw new Error('임시 작업 폴더에 링크를 사용할 수 없습니다.');
// One service process per work directory. Remove crash leftovers before accepting traffic.
for (const entry of await readdir(storage)) if (/^[a-f0-9]{24}$/.test(entry)) await rm(path.join(storage, entry), { recursive: true, force: true });
const jobs = new Map(), tickets = new Map();
const uploadLimit = Math.min(Number(process.env.MAX_UPLOAD_MB) || 100, 500) * 1024 * 1024;
const maxJobs = Math.max(1, Math.min(Number(process.env.MAX_JOBS) || 4, 20));
const ttl = Math.max(5, Math.min(Number(process.env.JOB_TTL_MINUTES) || 60, 240)) * 60000;
const key = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (status, message) => Object.assign(new Error(message), { status });
const upload = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, req.job.directory), filename: (req, file, cb) => cb(null, `${file.fieldname}${file.fieldname === 'dependencies' ? '.zip' : '.dwg'}`) }), limits: { fileSize: uploadLimit, files: 3, fields: 3, fieldSize: 200 }, fileFilter: (req, file, cb) => {
  const expected = file.fieldname === 'dependencies' ? '.zip' : '.dwg';
  if (!['reference', 'drawing', 'dependencies'].includes(file.fieldname) || path.extname(file.originalname).toLowerCase() !== expected) return cb(error(400, 'DWG와 관련 파일 ZIP만 업로드할 수 있습니다.'));
  cb(null, true);
} });

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  const origin = req.headers.origin;
  const publicOrigin = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : undefined;
  const allowed = process.env.FRONTEND_ORIGIN || publicOrigin;
  if (origin && allowed && origin !== allowed && origin !== publicOrigin) return res.status(403).json({ error: '허용되지 않은 사이트입니다.' });
  if (origin && origin === allowed) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, X-Job-Token', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/api/dwg/health', (req, res) => res.json({ ready: configured(), retentionMinutes: ttl / 60000, maxUploadMB: uploadLimit / 1024 / 1024 }));

function authorize(req, res, next) {
  const job = jobs.get(req.params.id);
  if (!job || job.expires < Date.now()) return next(error(410, '작업이 만료되었거나 삭제되었습니다.'));
  if (!equal(req.headers['x-job-token'], job.token)) return next(error(403, '작업 접근 권한이 없습니다.'));
  req.job = job; next();
}
async function cleanup(job) {
  job.cancelled = true;
  jobs.delete(job.id);
  for (const [id, ticket] of tickets) if (ticket.job === job) tickets.delete(id);
  if (job.workitem) await apsRequest(`/workitems/${encodeURIComponent(job.workitem)}`, 'DELETE').catch(() => {});
  await rm(job.directory, { recursive: true, force: true });
}
async function visitFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await visitFiles(path.join(directory, entry.name), name));
    else result.push({ file: path.join(directory, entry.name), name });
  }
  return result;
}
function signed(job, filename, verb, run) {
  const id = key(); tickets.set(id, { job, filename, verb, run, expires: job.expires, used: false });
  return `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/dwg/transfer/${id}`;
}

// APS downloads and uploads use short-lived, unguessable, per-workitem capabilities.
app.all('/api/dwg/transfer/:ticket', async (req, res, next) => {
  const ticket = tickets.get(req.params.ticket);
  if (!ticket || ticket.used || ticket.expires < Date.now() || ticket.job.cancelled || req.method !== ticket.verb) return next(error(403, '전송 권한이 만료되었습니다.'));
  if (req.method === 'GET') return res.sendFile(ticket.filename);
  ticket.used = true;
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, encoding, cb) { bytes += chunk.length; cb(bytes > 300 * 1024 * 1024 ? error(413, '출력 파일 한도를 초과했습니다.') : null, chunk); } });
  try { await pipeline(req, limiter, createWriteStream(ticket.filename, { flags: 'wx', mode: 0o600 })); res.sendStatus(200); }
  catch (err) { next(err); }
});

async function run(job, mode, selection) {
  const runId = key().slice(0, 12);
  const optionsPath = path.join(job.directory, `options-${runId}.json`);
  const resultZip = path.join(job.directory, `result-${runId}.zip`);
  const output = path.join(job.directory, `output-${runId}`);
  await writeFile(optionsPath, JSON.stringify({ mode, paper: selection?.paper || job.paper, ids: selection?.ids || [], space: job.space, referenceName: job.referenceName, plotStyle: job.plotStyle }), { mode: 0o600 });
  try {
    if (job.cancelled) return;
    const item = await apsRequest('/workitems', 'POST', { activityId: process.env.APS_ACTIVITY_ID, arguments: {
      input: { verb: 'get', url: signed(job, path.join(job.directory, 'input.zip'), 'GET', runId) },
      options: { verb: 'get', url: signed(job, optionsPath, 'GET', runId) },
      output: { verb: 'put', url: signed(job, resultZip, 'PUT', runId) }
    } });
    job.workitem = item.id;
    if (job.cancelled) { await apsRequest(`/workitems/${encodeURIComponent(item.id)}`, 'DELETE').catch(() => {}); return; }
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      if (job.cancelled) return;
      if (Date.now() > job.expires) throw error(410, '작업 제한 시간이 초과되었습니다.');
      const status = await apsRequest(`/workitems/${encodeURIComponent(item.id)}`);
      job.message = status.status === 'pending' ? 'CAD 엔진 실행을 기다리고 있습니다.' : 'CAD 엔진이 도면을 처리하고 있습니다.';
      if (status.status === 'success') break;
      if (!['pending', 'inprogress'].includes(status.status)) throw new Error(`CAD 처리에 실패했습니다 (${status.status}). 도면·관련 파일·APS 설정을 확인하세요.`);
    }
    job.workitem = null;
    if (job.cancelled) return;
    await mkdir(output, { mode: 0o700 });
    await extractZip(resultZip, output, { output: true });
    const manifest = await readManifest(output);
    if (job.cancelled) return;
    if (mode === 'analyze') {
      const ordered = job.space === 'layouts' ? manifest.frames : orderFrames(manifest.frames);
      for (const frame of ordered) {
        const bytes = await readFile(path.join(output, frame.pdf));
        const pdf = await PDFDocument.load(bytes);
        if (pdf.getPageCount() !== 1) throw new Error('미리보기 페이지 수가 올바르지 않습니다.');
      }
      job.frames = ordered; job.warnings = manifest.warnings || []; job.output = output;
      job.state = ordered.length ? 'review' : 'empty';
      job.message = ordered.length ? `감지된 페이지: ${ordered.length}개. 순서와 출력 설정을 확인하세요.` : '도곽을 찾지 못했습니다. 기준 도곽 또는 Layout 모드를 확인하세요.';
      if (!ordered.length) await rm(path.join(job.directory, 'input.zip'), { force: true });
    } else {
      const merged = await PDFDocument.create();
      const byId = new Map(manifest.frames.map(frame => [frame.id, frame]));
      for (const id of selection.ids) {
        const frame = byId.get(id);
        if (!frame) throw new Error('선택한 페이지가 출력 결과에 없습니다.');
        const part = await PDFDocument.load(await readFile(path.join(output, frame.pdf)));
        if (part.getPageCount() !== 1) throw new Error('출력 페이지 수가 올바르지 않습니다.');
        const [page] = await merged.copyPages(part, [0]); merged.addPage(page);
      }
      merged.setTitle('DWG 도곽별 PDF');
      job.pdf = path.join(job.directory, 'drawing.pdf');
      await writeFile(job.pdf, await merged.save(), { mode: 0o600 });
      job.pageCount = selection.ids.length; job.state = 'done';
      job.warnings = [...new Set([...job.warnings, ...(manifest.warnings || [])])];
      job.message = `${job.pageCount}페이지 PDF가 준비되었습니다. 원본 파일은 삭제되었습니다.`;
      await rm(path.join(job.directory, 'input.zip'), { force: true });
      await rm(output, { recursive: true, force: true });
      if (job.output) await rm(job.output, { recursive: true, force: true });
      job.output = null;
    }
  } catch (err) {
    if (!job.cancelled) {
      job.state = 'failed'; job.message = err.message;
      await Promise.all([rm(path.join(job.directory, 'input.zip'), { force: true }), rm(output, { recursive: true, force: true })]);
    }
  } finally {
    for (const [id, ticket] of tickets) if (ticket.job === job && ticket.run === runId) tickets.delete(id);
    await Promise.all([rm(optionsPath, { force: true }), rm(resultZip, { force: true })]);
    if (job.cancelled) await rm(job.directory, { recursive: true, force: true });
  }
}

app.post('/api/dwg/jobs', async (req, res, next) => {
  if (!configured()) return next(error(503, '변환 서버의 APS 설정이 아직 완료되지 않았습니다.'));
  if (jobs.size >= maxJobs) return next(error(429, '서버의 작업 한도에 도달했습니다. 잠시 후 다시 시도하세요.'));
  const id = key().slice(0, 24);
  const job = { id, token: key(), state: 'uploading', directory: path.join(storage, id), expires: Date.now() + ttl, frames: [], warnings: [], message: '파일 업로드 중' };
  jobs.set(id, job); req.job = job;
  try { await mkdir(job.directory, { mode: 0o700 }); }
  catch (err) { await cleanup(job); return next(err); }
  upload.fields([{ name: 'reference', maxCount: 1 }, { name: 'drawing', maxCount: 1 }, { name: 'dependencies', maxCount: 1 }])(req, res, async uploadError => {
    try {
      if (uploadError) throw uploadError;
      if (!req.files?.reference || !req.files?.drawing) throw error(400, '기준 도곽과 실제 도면 DWG를 모두 선택하세요.');
      job.paper = req.body.paper || 'A3'; job.space = req.body.space || 'model';
      if (!['A4', 'A3', 'A2', 'A1', 'layout'].includes(job.paper) || !['model', 'layouts'].includes(job.space)) throw error(400, '출력 설정을 확인하세요.');
      job.referenceName = req.files.reference[0].originalname.replace(/[^\p{L}\p{N}_. -]/gu, '').slice(0, 120);
      job.plotStyle = req.body.plotStyle || '';
      if (job.plotStyle && (!/^[\p{L}\p{N}_. -]+\.(ctb|stb)$/iu.test(job.plotStyle) || job.plotStyle.length > 120)) throw error(400, '출력 스타일은 ZIP 안의 CTB/STB 파일명으로 입력하세요.');
      await Promise.all(['reference.dwg', 'drawing.dwg'].map(name => verifyDwg(path.join(job.directory, name))));
      const deps = path.join(job.directory, 'deps'); await mkdir(deps, { mode: 0o700 });
      if (req.files.dependencies) await extractZip(path.join(job.directory, 'dependencies.zip'), deps);
      const entries = [{ file: path.join(job.directory, 'reference.dwg'), name: 'reference.dwg' }, { file: path.join(job.directory, 'drawing.dwg'), name: 'drawing.dwg' }, ...(await visitFiles(deps)).map(e => ({ ...e, name: `deps/${e.name}` }))];
      await makeZip(path.join(job.directory, 'input.zip'), entries);
      await Promise.all(['reference.dwg', 'drawing.dwg', 'dependencies.zip', 'deps'].map(name => rm(path.join(job.directory, name), { recursive: true, force: true })));
      if (job.cancelled) return;
      job.state = 'analyzing'; job.message = '도곽과 출력 자료를 분석하고 있습니다.';
      res.status(202).json({ id, token: job.token, expires: job.expires });
      void run(job, 'analyze');
    } catch (err) { await cleanup(job); next(Object.assign(err, { status: err.status || 400 })); }
  });
});
app.get('/api/dwg/jobs/:id', authorize, (req, res) => {
  const { state, message, frames, warnings, expires, pageCount } = req.job;
  res.json({ state, message, frames, warnings, expires, pageCount });
});
app.get('/api/dwg/jobs/:id/pages/:page', authorize, (req, res, next) => {
  const frame = req.job.frames.find(f => f.id === req.params.page);
  if (!frame || !req.job.output) return next(error(404, '미리보기를 찾지 못했습니다.'));
  res.type('pdf').sendFile(path.join(req.job.output, frame.pdf));
});
app.post('/api/dwg/jobs/:id/generate', authorize, async (req, res, next) => {
  const job = req.job;
  if (job.state !== 'review') return next(error(409, '분석이 완료된 작업만 출력할 수 있습니다.'));
  let selection;
  try { selection = validateSelection(req.body, job.frames); } catch (err) { return next(error(400, err.message)); }
  if (job.space === 'model' && selection.paper === 'layout') return next(error(400, 'Model Space는 A4~A1 용지를 선택하세요.'));
  job.state = 'generating'; job.message = '선택한 순서와 용지로 PDF를 출력하고 있습니다.';
  res.status(202).json({ state: job.state }); void run(job, 'generate', selection);
});
app.get('/api/dwg/jobs/:id/download', authorize, (req, res, next) => {
  if (req.job.state !== 'done' || !req.job.pdf) return next(error(409, 'PDF가 아직 준비되지 않았습니다.'));
  res.download(req.job.pdf, 'drawing.pdf');
});
app.delete('/api/dwg/jobs/:id', authorize, async (req, res, next) => {
  try { await cleanup(req.job); res.sendStatus(204); } catch (err) { next(err); }
});

// Explicit allowlist prevents serving .env, source, CAD inputs or the repository.
app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
for (const name of ['dwg-pdf.html', 'dwg-pdf.css', 'dwg-pdf.js', 'dwg-pdf-config.js', 'index.html', 'style.css', 'script.js', 'ui.css', 'common.css', 'receipt.html', 'receipt.css', 'receipt.js', 'cutout.html', 'cutout.js', 'imagekit.js'])
  app.get(`/${name}`, (req, res) => res.sendFile(path.join(root, name)));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
  res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '업로드 파일이 크기 제한을 초과했습니다.' : status === 500 ? '서버 처리 오류가 발생했습니다.' : err.message });
});
setInterval(() => { for (const job of jobs.values()) if (job.expires < Date.now()) void cleanup(job).catch(() => {}); }, 30000).unref();
const server = app.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`DWG service listening; APS ${configured() ? 'configured' : 'not configured'}`));
async function shutdown() {
  server.close();
  await Promise.allSettled([...jobs.values()].map(cleanup));
  await rm(storage, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
