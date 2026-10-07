import yauzl from 'yauzl';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const INPUT_EXTENSIONS = new Set(['.dwg', '.shx', '.ttf', '.ctb', '.stb', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.pc3', '.pmp', '.fmp']);

export async function extractZip(file, destination, { output = false, maxBytes = 300 * 1024 * 1024 } = {}) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (err, z) => err ? reject(err) : resolve(z)));
  let count = 0, total = 0;
  const names = new Set();
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', async entry => {
        try {
          const name = entry.fileName;
          if (++count > 2000 || name.includes('\\') || name.startsWith('/') || name.includes(':') || name.split('/').some(p => p === '..' || p === '.' || p.startsWith('.')))
            throw new Error('안전하지 않은 ZIP 경로입니다.');
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode === 0xa000 || (entry.generalPurposeBitFlag & 1)) throw new Error('링크 또는 암호화 ZIP은 지원하지 않습니다.');
          if (name.endsWith('/')) { zip.readEntry(); return; }
          total += entry.uncompressedSize;
          if (total > maxBytes || entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 1000) throw new Error('ZIP 압축 해제 한도를 초과했습니다.');
          const ext = path.extname(name).toLowerCase();
          if (output ? !(ext === '.pdf' || name === 'manifest.json') : !INPUT_EXTENSIONS.has(ext)) throw new Error(`지원하지 않는 ZIP 파일 형식: ${ext}`);
          const folded = name.toLowerCase();
          if (names.has(folded)) throw new Error('ZIP에 중복 경로가 있습니다.');
          names.add(folded);
          const target = path.join(destination, name);
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          const stream = await new Promise((res, rej) => zip.openReadStream(entry, (err, s) => err ? rej(err) : res(s)));
          await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
          if (ext === '.dwg') await verifyDwg(target);
          zip.readEntry();
        } catch (error) { reject(error); zip.close(); }
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
  return [...names];
}

export async function verifyDwg(file) {
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(6); await handle.read(buffer, 0, 6, 0);
    if (!/^AC10\d{2}$/.test(buffer.toString('ascii'))) throw new Error('유효한 DWG 파일 헤더가 아닙니다.');
  } finally { await handle.close(); }
}

export async function makeZip(destination, entries) {
  const zip = new yazl.ZipFile();
  for (const { file, name } of entries) zip.addFile(file, name);
  const writing = pipeline(zip.outputStream, createWriteStream(destination, { mode: 0o600 }));
  zip.end(); await writing;
}

export async function readManifest(directory) {
  const data = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.frames) || data.frames.length > 200 || new Set(data.frames.map(f => f.id)).size !== data.frames.length) throw new Error('잘못된 분석 결과입니다.');
  for (const f of data.frames) {
    if (!/^[a-zA-Z0-9_-]+$/.test(f.id) || f.pdf !== `${f.id}.pdf` || !Array.isArray(f.center) || f.center.length !== 2 || !f.center.every(Number.isFinite) || !Number.isFinite(f.width) || !Number.isFinite(f.height) || f.width <= 0 || f.height <= 0)
      throw new Error('잘못된 도곽 정보입니다.');
  }
  return data;
}
