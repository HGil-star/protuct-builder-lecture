// TEST ONLY: replaces the network provider in a child server; no production demo mode.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { makeZip } from '../archive.js';
const actualFetch = globalThis.fetch;
const items = new Map(); let next = 0;
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const local = url => url.replace('https://fixture.example', `http://127.0.0.1:${process.env.PORT}`);
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('/authentication/v2/token')) return json({ access_token: 'test-only', expires_in: 3600 });
  if (!String(url).startsWith('https://developer.api.autodesk.com/da/')) return actualFetch(url, options);
  if (options.method === 'POST') {
    const body = JSON.parse(options.body); const id = String(++next); items.set(id, 'inprogress');
    const config = await (await actualFetch(local(body.arguments.options.url))).json();
    const input = await actualFetch(local(body.arguments.input.url)); if (!input.ok) throw new Error('input capability failed');
    const temp = await mkdtemp(path.join(tmpdir(), 'mock-aps-'));
    const frames = [
      { id: 'right', name: 'Frame R', source: 'Block', center: [200, 100], width: 200, height: 100, pdf: 'right.pdf' },
      { id: 'left', name: 'Frame L', source: 'XREF', center: [0, 101], width: 100, height: 100, pdf: 'left.pdf' }
    ].filter(f => config.mode !== 'generate' || config.ids.includes(f.id));
    const entries = [];
    for (const frame of frames) {
      const pdf = await PDFDocument.create(); pdf.addPage([frame.width, frame.height]);
      const file = path.join(temp, frame.pdf); await writeFile(file, await pdf.save()); entries.push({ file, name: frame.pdf });
    }
    const manifest = path.join(temp, 'manifest.json'); await writeFile(manifest, JSON.stringify({ frames, warnings: ['TEST: synthetic CAD output'] })); entries.push({ file: manifest, name: 'manifest.json' });
    const zip = path.join(temp, 'output.zip'); await makeZip(zip, entries);
    const response = await actualFetch(local(body.arguments.output.url), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(zip) });
    if (!response.ok) throw new Error('output capability failed');
    items.set(id, 'success'); await rm(temp, { recursive: true, force: true }); return json({ id });
  }
  if (options.method === 'DELETE') return new Response(null, { status: 204 });
  const id = String(url).split('/').at(-1); return json({ status: items.get(id) || 'success' });
};
