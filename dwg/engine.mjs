// DWG/DXF → 도곽별 PDF 변환 엔진. 브라우저 Worker와 Node 테스트에서 함께 사용합니다.
// LibreDWG(WebAssembly)로 DWG를 DXF로 바꾸고, Pyodide의 ezdxf로 도곽 검출과 PDF 출력을 합니다.
export const PYODIDE_VERSION = '0.28.3';
const EZDXF_WHEEL = 'vendor/ezdxf-1.4.4-py3-none-any.whl';
const FONT = 'NanumGothic.ttf';

export async function createEngine({ loadPyodide, createDwg2dxf, readAsset, progress = () => {} }) {
  progress('Python 실행 환경을 불러오는 중');
  const py = await loadPyodide();
  progress('도면 라이브러리를 불러오는 중');
  await py.loadPackage(['numpy', 'fonttools', 'pyparsing', 'typing-extensions', 'pillow', 'micropip'], { messageCallback() {} });
  py.FS.mkdirTree('/app/fonts');
  py.FS.mkdirTree('/work');
  const [wheel, font, module] = await Promise.all([readAsset(EZDXF_WHEEL), readAsset(`vendor/fonts/${FONT}`), readAsset('dwg_sheets.py')]);
  py.FS.writeFile(`/app/${EZDXF_WHEEL.split('/').pop()}`, wheel);
  py.FS.writeFile(`/app/fonts/${FONT}`, font);
  py.FS.writeFile('/app/dwg_sheets.py', module);
  await py.runPythonAsync(`
import sys, micropip
await micropip.install('emfs:/app/${EZDXF_WHEEL.split('/').pop()}', deps=False)
sys.path.insert(0, '/app')
import dwg_sheets
dwg_sheets.setup_fonts('/app/fonts', '${FONT}')
`);
  const sheets = py.pyimport('dwg_sheets');

  async function toDxf(bytes) {
    const log = [];
    const lib = await createDwg2dxf({ print() {}, printErr: line => log.push(line) });
    lib.FS.writeFile('/in.dwg', bytes);
    const exitCode = globalThis.process?.exitCode; // Node에서는 LibreDWG 종료 코드가 프로세스 종료 코드로 남음
    try { lib.callMain(['-y', '-o', '/out.dxf', '/in.dwg']); } catch (err) { log.push(String(err)); }
    finally { if (globalThis.process) globalThis.process.exitCode = exitCode; }
    let dxf = null;
    try { dxf = lib.FS.readFile('/out.dxf'); } catch {}
    if (!dxf?.length) {
      const reason = log.find(l => /error|unsupported|invalid/i.test(l)) || log.at(-1) || '';
      throw new Error(`DWG 파일을 읽지 못했습니다. 지원하지 않는 버전이거나 손상된 파일일 수 있습니다.${reason ? `\n(${reason.trim()})` : ''}`);
    }
    return dxf;
  }

  const toJs = value => { const out = value.toJs({ dict_converter: Object.fromEntries }); value.destroy?.(); return out; };

  return {
    async analyze(bytes, name, mode, reference = null) {
      const readDxf = async (data, fileName, label) => {
        if (!/\.dwg$/i.test(fileName)) return data;
        progress(`${label} DWG를 읽는 중`);
        return toDxf(data);
      };
      let refInfo = null;
      if (reference && mode === 'model') {
        py.FS.writeFile('/work/ref.dxf', await readDxf(reference.bytes, reference.name, '기준 도곽'));
        try { refInfo = toJs(sheets.reference('/work/ref.dxf')); }
        finally { py.FS.unlink('/work/ref.dxf'); }
      }
      py.FS.writeFile('/work/in.dxf', await readDxf(bytes, name, '도면'));
      progress('도곽을 찾는 중');
      try {
        const result = toJs(sheets.analyze('/work/in.dxf', mode, Boolean(refInfo)));
        return { ...result, warnings: [...(refInfo?.warnings || []), ...result.warnings], reference: refInfo };
      }
      finally { py.FS.unlink('/work/in.dxf'); }
    },
    thumbnail(id, mono) { return sheets.thumbnail(id, mono); },
    pdf(ids, paper, mono) {
      const list = py.toPy(ids);
      try { const proxy = sheets.render_pdf(list, paper, mono); const bytes = proxy.toJs(); proxy.destroy(); return bytes; }
      finally { list.destroy(); }
    },
  };
}
