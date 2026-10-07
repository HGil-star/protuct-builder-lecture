import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './archive.js';
import { apsRequest } from './aps.js';

// Run explicitly after configuring the APS app. Never called by the web service.
const directory = path.dirname(fileURLToPath(import.meta.url));
const bundleName = process.env.APS_BUNDLE_ID || 'DwgPdf';
const activityName = process.env.APS_ACTIVITY_NAME || 'DwgPdf';
const alias = process.env.APS_ALIAS || 'production';
const engine = process.env.APS_ENGINE || 'Autodesk.AutoCAD+25_1';
for (const value of [bundleName, activityName, alias]) if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) throw new Error('APS 이름 설정을 확인하세요.');
const dll = path.join(directory, 'cad/bin/Release/net8.0/DwgPdf.dll');
await stat(dll);
const zipPath = path.join(directory, 'cad/DwgPdf.zip');
await makeZip(zipPath, [{ file: path.join(directory, 'cad/DwgPdf.bundle/PackageContents.xml'), name: 'DwgPdf.bundle/PackageContents.xml' }, { file: dll, name: 'DwgPdf.bundle/Contents/DwgPdf.dll' }]);

async function createOrVersion(type, id, spec) {
  let exists = false, page;
  do {
    const collection = await apsRequest(`/${type}${page ? `?page=${encodeURIComponent(page)}` : ''}`);
    exists ||= collection.data?.some(value => value === id || value.endsWith(`.${id}`));
    page = collection.paginationToken;
  } while (page && !exists);
  return apsRequest(`/${type}/${exists ? `${id}/versions` : ''}`.replace(/\/$/, ''), 'POST', exists ? spec : { id, ...spec });
}
async function setAlias(type, id, version) {
  const aliases = await apsRequest(`/${type}/${id}/aliases`);
  const exists = aliases.data?.some(a => a.id === alias);
  return apsRequest(`/${type}/${id}/aliases${exists ? `/${alias}` : ''}`, exists ? 'PATCH' : 'POST', exists ? { version } : { id: alias, version });
}
const bundle = await createOrVersion('appbundles', bundleName, { engine, description: '도곽 검출과 PDF 출력' });
const form = new FormData();
for (const [key, value] of Object.entries(bundle.uploadParameters.formData)) form.append(key, String(value));
form.append('file', new Blob([await readFile(zipPath)]), 'DwgPdf.zip');
const upload = await fetch(bundle.uploadParameters.endpointURL, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
if (!upload.ok) throw new Error(`AppBundle 업로드 실패 (${upload.status})`);
await setAlias('appbundles', bundleName, bundle.version);
const bundleId = `${bundle.id}+${alias}`;
const activity = await createOrVersion('activities', activityName, {
  engine, appbundles: [bundleId], description: 'DWG 도곽 분석 및 페이지별 PDF ZIP',
  commandLine: [`"$(engine.path)\\accoreconsole.exe" /i "$(args[input].path)\\drawing.dwg" /al "$(appbundles[${bundleName}].path)" /s "$(settings[script].path)"`],
  parameters: {
    input: { verb: 'get', zip: true, localName: 'input', required: true },
    options: { verb: 'get', localName: 'options.json', required: true },
    output: { verb: 'put', localName: 'result.zip', required: true }
  },
  settings: { script: { value: 'FILEDIA\n0\nCMDDIA\n0\nSECURELOAD\n2\nBACKGROUNDPLOT\n0\nDWGPDF\n_QUIT\n_N\n' } }
});
await setAlias('activities', activityName, activity.version);
console.log(`등록 완료. .env에 APS_ACTIVITY_ID=${activity.id}+${alias} 설정 후 서버를 다시 시작하세요.`);
