import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { extractZip, verifyDwg, readManifest } from '../archive.js';
async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'dwg-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const zip = new yazl.ZipFile(); for (const [name, data] of files) zip.addBuffer(Buffer.from(data), name);
  const archive = path.join(root, 'input.zip'); const writing = pipeline(zip.outputStream, createWriteStream(archive)); zip.end(); await writing;
  const out = path.join(root, 'out'); await mkdir(out); return { archive, out, root };
}
test('safe ZIP preserves nested XREF paths and verifies DWG header', async t => {
  const { archive, out } = await fixture(t, [['refs/frame.dwg', 'AC1032test'], ['fonts/korean.shx', 'font']]);
  await extractZip(archive, out); assert.equal(await readFile(path.join(out, 'refs/frame.dwg'), 'utf8'), 'AC1032test');
});
test('ZIP rejects executable input and absolute Windows paths', async t => {
  for (const name of ['autorun.lsp', 'driver.exe', 'refs/C:frame.dwg']) {
    const { archive, out } = await fixture(t, [[name, 'AC1032']]); await assert.rejects(extractZip(archive, out));
  }
});
test('ZIP rejects parent traversal even when central-directory metadata is malicious', async t => {
  const { archive, out } = await fixture(t, [['safe/a.dwg', 'AC1032']]);
  const bytes = await readFile(archive), from = Buffer.from('safe/a.dwg'), to = Buffer.from('../bad.dwg');
  for (let offset = bytes.indexOf(from); offset !== -1; offset = bytes.indexOf(from, offset + to.length)) to.copy(bytes, offset);
  await writeFile(archive, bytes); await assert.rejects(extractZip(archive, out));
});
test('ZIP rejects expanded size limit and case-insensitive path collisions', async t => {
  const first = await fixture(t, [['a.shx', 'x'.repeat(100)]]); await assert.rejects(extractZip(first.archive, first.out, { maxBytes: 99 }));
  const second = await fixture(t, [['A.shx', 'a'], ['a.shx', 'b']]); await assert.rejects(extractZip(second.archive, second.out));
});
test('invalid DWG and PDF result traversal are rejected', async t => {
  const { archive, out, root } = await fixture(t, [['fake.dwg', 'notdwg']]); await assert.rejects(extractZip(archive, out));
  const file = path.join(root, 'text.dwg'); await writeFile(file, 'text'); await assert.rejects(verifyDwg(file));
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ frames: [{ id: 'a', pdf: '../secret.pdf', center: [0, 0], width: 1, height: 1 }] })); await assert.rejects(readManifest(out));
});
