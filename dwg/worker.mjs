import { createEngine, PYODIDE_VERSION } from './engine.mjs';

const pyodideBase = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let engine = null;

const ready = (async () => {
  const { loadPyodide } = await import(`${pyodideBase}pyodide.mjs`);
  const { default: createDwg2dxf } = await import('./vendor/libredwg/dwg2dxf.mjs');
  engine = await createEngine({
    loadPyodide: () => loadPyodide({ indexURL: pyodideBase }),
    createDwg2dxf,
    readAsset: async path => {
      const response = await fetch(new URL(path, import.meta.url));
      if (!response.ok) throw new Error(`${path}를 불러오지 못했습니다 (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
    progress: text => postMessage({ type: 'progress', text }),
  });
})();

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    await ready;
    let result, transfer = [];
    if (type === 'init') result = true;
    else if (type === 'analyze') result = await engine.analyze(new Uint8Array(data.file), data.name, data.mode, data.reference ? { bytes: new Uint8Array(data.reference.file), name: data.reference.name } : null);
    else if (type === 'thumbnail') result = engine.thumbnail(data.page, data.mono);
    else if (type === 'pdf') { result = engine.pdf(data.pages, data.paper, data.mono); transfer = [result.buffer]; }
    postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    const text = String(err?.message || err);
    // Python 예외는 마지막 줄(예: "ValueError: 메시지")만 보여줌
    const error = err?.type || text.startsWith('PythonError') ? text.trim().split('\n').at(-1).replace(/^\w+(Error|Exception):\s*/, '') : text;
    postMessage({ id, ok: false, error });
  }
};
