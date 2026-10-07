import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadPyodide } from 'pyodide';
import createDwg2dxf from '../vendor/libredwg/dwg2dxf.mjs';
import { createEngine } from '../engine.mjs';

const root = new URL('../', import.meta.url);
const engine = await createEngine({
  loadPyodide,
  createDwg2dxf,
  readAsset: async path => new Uint8Array(await fs.readFile(new URL(path, root))),
});
const sample = await fs.readFile(new URL('test/fixtures/sheets.dwg', root));

test('DWG에서 도곽 4개를 순서대로 찾는다', async () => {
  const { pages, warnings } = await engine.analyze(sample, 'sheets.dwg', 'model');
  assert.deepEqual(warnings, []);
  assert.deepEqual(pages.map(p => [p.id, p.source, p.name, p.number]), [
    ['P1', '블록', '1층 평면도', 'A-101'],
    ['P2', '블록', '정면도', 'A-201'],
    ['P3', '블록', '계단 상세도', 'A-501'],
    ['P4', '사각형', '', ''],
  ]);
});

test('선택한 순서대로 용지 크기의 PDF 페이지를 만든다', async () => {
  const pdf = Buffer.from(engine.pdf(['P3', 'P1'], 'A4', true)).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Count 2/);
  assert.equal(pdf.match(/\/MediaBox \[0 0 841\.89 595\.28\]/g).length, 2);
  assert.match(pdf, /%%EOF\n$/);
});

test('미리보기 SVG를 만든다', () => {
  const svg = engine.thumbnail('P2', true);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<path /);
});

test('손상된 DWG는 이해할 수 있는 오류로 거절한다', async () => {
  await assert.rejects(engine.analyze(new Uint8Array(200).fill(7), 'broken.dwg', 'model'), /DWG 파일을 읽지 못했습니다/);
});
