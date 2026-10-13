import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { loadPyodide } from 'pyodide';
import createDwg2dxf from '../vendor/libredwg/dwg2dxf.mjs';
import { createEngine, jpegComponents } from '../engine.mjs';

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
  const { bytes, skipped } = engine.pdf(['P3', 'P1'], 'A4', true);
  assert.equal(skipped, 0);
  const pdf = Buffer.from(bytes).toString('latin1');
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

const fixture = name => fs.readFile(new URL(`test/fixtures/${name}`, root));

test('기준 도곽과 같은 양식만 찾는다 (분해된 선 포함, 오검출 사각형 제외)', async () => {
  const drawing = await fixture('drawing.dwg');
  const reference = { bytes: await fixture('reference.dwg'), name: 'reference.dwg' };
  const result = await engine.analyze(drawing, 'drawing.dwg', 'model', reference);
  assert.deepEqual(result.reference, { names: ['SHEET_K'], ratio: 1.6, width: 800, labels: [], height: 500, lineCount: 7, space: 'Model', warnings: [] });
  assert.deepEqual(result.pages.map(p => [p.source, p.name, p.number, Math.round(p.width)]), [
    ['기준 블록', '배치도', 'C-001', 8000],
    ['기준 블록', '단면도', 'C-002', 8000],
    ['기준 블록', '상세도', 'C-003', 4000],
    ['기준 형상', '', '', 4000],
  ]);
});

test('기준 도곽 없이 같은 도면을 읽으면 자동 검출 결과를 쓴다', async () => {
  const result = await engine.analyze(await fixture('drawing.dwg'), 'drawing.dwg', 'model');
  assert.equal(result.reference, null);
  assert.ok(result.pages.some(p => p.source === '사각형' && Math.round(p.width) === 5940)); // 기준이 없으면 걸러내지 못하는 사각형
});

test('사각형이 아닌 기준 파일은 이유를 알려준다', async () => {
  const empty = new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n0\nENDSEC\n0\nEOF\n');
  await assert.rejects(engine.analyze(sample, 'sheets.dwg', 'model', { bytes: empty, name: 'ref.dxf' }), /사각형 도곽을 이루지 않습니다/);
});

test('줄바꿈이 섞인 문자열로 깨진 DXF를 복구해 읽는다 (Invalid group code "굴림")', async () => {
  // LibreDWG가 값 안의 LF·CR·CRLF를 그대로 써서 그룹 코드 자리에 "굴림"이 오는 실제 사례 재현
  const broken = await fixture('broken-strings.dxf');
  const result = await engine.analyze(broken, 'broken-strings.dxf', 'model');
  assert.equal(result.pages.length, 4);
  assert.deepEqual(result.pages.slice(0, 2).map(p => [p.name, p.number]), [['1층 평면도', 'A-101 굴림'], ['정면도', 'A-201']]);
  assert.match(result.warnings[0], /읽을 수 없는 부분 3곳을 복구/);
});

for (const [file, names, space] of [
  ['ref-lines.dxf', [], 'Model'],          // 끊기고 모서리가 튀어나온 선 + 도곽 밖 메모
  ['ref-poly8.dxf', [], 'Model'],          // 꼭짓점 8개 폴리라인
  ['ref-nested.dxf', ['HDR_BLOCK'], 'Model'], // 중첩 블록, 축척 2
  ['ref-layout.dxf', [], 'Layout1'],       // Layout에 그린 도곽
]) {
  test(`여러 방식으로 그린 기준 도곽을 인식한다: ${file}`, async () => {
    const result = await engine.analyze(await fixture('drawing.dwg'), 'drawing.dwg', 'model', { bytes: await fixture(file), name: file });
    assert.deepEqual([result.reference.names, result.reference.ratio, result.reference.space, result.reference.warnings], [names, 1.6, space, []]);
    assert.deepEqual(result.pages.map(p => [p.source, p.name]), [
      ['기준 블록', '배치도'], ['기준 블록', '단면도'], ['기준 블록', '상세도'], ['기준 형상', ''],
    ]);
  });
}

test('핸들이 0인 객체가 있는 DXF를 복구해 읽는다 (Invalid handle 0)', async () => {
  const result = await engine.analyze(await fixture('zero-handle.dxf'), 'zero-handle.dxf', 'model');
  assert.equal(result.pages.length, 4);
  assert.deepEqual([result.pages[0].name, result.pages[0].number], ['1층 평면도', 'A-101']);
  assert.match(result.warnings[0], /읽을 수 없는 부분 1곳을 복구/);
});

for (const [kind, nth] of [['LAYER', 0], ['LTYPE', 0], ['BLOCK_RECORD', 0]]) {
  test(`이름 없는 ${kind} 테이블 항목을 복구해 읽는다 (name has to be a string)`, async () => {
    const result = await engine.analyze(await fixture(`noname-${kind.toLowerCase()}.dxf`), 'x.dxf', 'model');
    assert.deepEqual(result.pages.map(p => p.name).slice(0, 3), ['1층 평면도', '정면도', '계단 상세도']);
    assert.match(result.warnings[0], /읽을 수 없는 부분 \d+곳을 복구/);
    assert.equal(engine.pdf(result.pages.map(p => p.id), 'A3', true).skipped, 0);
  });
}

test('모든 레이어가 꺼진 것으로 변환된 도면은 레이어를 다시 켠다 (LibreDWG 0.13 색 오류)', async () => {
  const result = await engine.analyze(await fixture('all-layers-off.dxf'), 'x.dxf', 'model');
  assert.equal(result.pages.length, 4);
  const pdf = Buffer.from(engine.pdf(['P1'], 'A3', true).bytes);
  assert.ok(pdf.length > 3000, `빈 페이지가 아니어야 함 (${pdf.length} bytes)`);
});

test('트루컬러 레이어(색 번호 0)가 섞여 있어도 꺼진 레이어를 다시 켠다', async () => {
  // Rhino Make2D 레이어처럼 트루컬러만 있는 레이어는 LibreDWG가 색 번호를 부호 없이 0으로 씀
  const text = (await fixture('all-layers-off.dxf')).toString('utf8');
  const truecolor = text.replace(/(\n  2(\r?\n)Defpoints\2 70\2 +\d+\2 62\2) *-7\2/, '$1     0$2420$2-1040187392$2');
  assert.notEqual(truecolor, text);
  const result = await engine.analyze(new TextEncoder().encode(truecolor), 'x.dxf', 'model');
  assert.equal(result.pages.length, 4);
  const pdf = Buffer.from(engine.pdf(['P1'], 'A3', true).bytes);
  assert.ok(pdf.length > 3000, `빈 페이지가 아니어야 함 (${pdf.length} bytes)`);
});

test('연결 이미지는 올린 파일을 이름으로 찾아 PDF에 넣는다', async () => {
  const drawing = await fixture('linked-image.dxf');
  const without = await engine.analyze(drawing, 'linked-image.dxf', 'model');
  assert.ok(without.warnings.some(w => w.includes('Logo.PNG') && w.includes('이미지 파일 칸')));
  assert.doesNotMatch(Buffer.from(engine.pdf(['P1'], 'A4', false).bytes).toString('latin1'), /\/Subtype \/Image/);

  const images = [{ bytes: await fixture('logo.png'), name: 'logo.png' }]; // 대소문자·경로가 달라도 같은 파일
  const result = await engine.analyze(drawing, 'linked-image.dxf', 'model', null, images);
  assert.ok(!result.warnings.some(w => w.includes('Logo.PNG')));
  const pdf = Buffer.from(engine.pdf(['P1'], 'A4', false).bytes).toString('latin1');
  assert.match(pdf, /\/Subtype \/Image \/Width 40 \/Height 20 \/ColorSpace \/DeviceRGB/);
  assert.match(pdf, /\/XObject << \/Im0 \d+ 0 R >>/);
  assert.match(engine.thumbnail('P1', false), /<image [^>]*href="data:image\/png;base64,/);
});

test('이미지의 투명·흰 배경은 기본으로 투명하게, 옵션을 끄면 흰색으로 출력한다 (검은 배경 방지)', async () => {
  // 투명 배경(RGB 0) 위에 흰 사각형과 빨간 글자가 있는 로고. ezdxf는 투명 사용 플래그가 없으면 투명 부분을 검게 만듦
  const images = [{ bytes: await fixture('logo-alpha.png'), name: 'logo.png' }];
  await engine.analyze(await fixture('linked-image.dxf'), 'linked-image.dxf', 'model', null, images);
  const imageStreams = pdf => [...pdf.matchAll(/<< \/Type \/XObject \/Subtype \/Image [^]*?\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)]
    .map(m => ({ head: m[0], data: zlib.inflateSync(Buffer.from(pdf.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1])), 'latin1')) }));

  const clear = imageStreams(Buffer.from(engine.pdf(['P1'], 'A4', false).bytes).toString('latin1'));
  const mask = clear.find(s => s.head.includes('/DeviceGray') && !s.head.includes('/SMask'));
  const rgb = clear.find(s => s.head.includes('/DeviceRGB'));
  assert.match(rgb.head, /\/SMask \d+ 0 R/);
  assert.equal(mask.data.filter(a => a === 255).length, 16 * 6, '빨간 글자만 보이고 흰색·투명 부분은 가림');

  const white = imageStreams(Buffer.from(engine.pdf(['P1'], 'A4', false, false).bytes).toString('latin1'));
  assert.equal(white.length, 1);
  assert.doesNotMatch(white[0].head, /\/SMask/);
  const pixels = [...white[0].data];
  assert.ok(!pixels.some((v, i) => i % 3 === 0 && v === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0), '검은 픽셀이 없어야 함');
  assert.match(engine.thumbnail('P1', false, false), /<image [^>]*href="data:image\/png;base64,/);
});

test('CMYK JPEG를 알아본다 (Worker에서 브라우저 디코더로 PNG로 바꿔 검은 로고를 막음)', async () => {
  // Pyodide의 Pillow는 Adobe CMYK JPEG를 YCCK로 잘못 풀어 흰 바탕이 거의 검게 나옴
  assert.equal(jpegComponents(await fixture('logo-cmyk.jpg')), 4);
  assert.equal(jpegComponents(await fixture('logo-rgb.jpg')), 3);
  assert.equal(jpegComponents(await fixture('logo-alpha.png')), 0);
  assert.equal(jpegComponents(new Uint8Array([0xff, 0xd8, 0xff])), 0);
});
