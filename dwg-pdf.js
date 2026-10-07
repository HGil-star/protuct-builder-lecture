(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const worker = new Worker('dwg/worker.mjs', { type: 'module' });
  const calls = new Map();
  let callId = 0, ready = false, busy = false, frames = [], initialOrder = [], selected = new Set(), mode = 'model', fileName = 'drawing';
  let pdfUrl = null, previewUrl = null, thumbRun = 0;
  const thumbUrls = new Map();

  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { if (!ready) $('engine-status').textContent = `${data.text}…`; else if (busy) message(`${data.text}…`); return; }
    const call = calls.get(data.id); if (!call) return; calls.delete(data.id);
    data.ok ? call.resolve(data.result) : call.reject(new Error(data.error));
  };
  worker.onerror = () => { $('engine-status').textContent = '변환 도구를 불러오지 못했습니다. 최신 Chrome·Edge·Safari·Firefox에서 페이지를 새로고침하세요.'; };
  const run = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => { const id = ++callId; calls.set(id, { resolve, reject }); worker.postMessage({ id, type, ...payload }, transfer); });

  const message = (text, isError = false) => { $('message').textContent = text; $('message').classList.toggle('error', isError); };
  function setStep(step) { for (const name of ['upload', 'review', 'download']) { if (name === step) $(`step-${name}`).setAttribute('aria-current', 'step'); else $(`step-${name}`).removeAttribute('aria-current'); } }
  function toggleBusy(value) {
    busy = value; const analysed = frames.length > 0 || !$('review').hidden;
    $('upload-fields').disabled = value || analysed; $('analyze').disabled = value || !ready || analysed;
    $('generate').disabled = value || !selected.size; $('reset-order').disabled = value; $('output-paper').disabled = value;
    $('cancel').hidden = !analysed; $('cancel').disabled = value;
    for (const input of $('pages').querySelectorAll('button,input')) input.disabled = value || input.dataset.disabled === 'true';
  }
  const revoke = url => { if (url) URL.revokeObjectURL(url); };
  function reset() {
    thumbRun++; thumbQueue.clear(); observer.disconnect(); frames = []; initialOrder = []; selected.clear();
    for (const url of thumbUrls.values()) revoke(url); thumbUrls.clear();
    revoke(pdfUrl); pdfUrl = null;
    $('review').hidden = true; $('download-panel').hidden = true; $('pages').replaceChildren(); message('');
    toggleBusy(false); setStep('upload');
  }
  function warnings(list) {
    $('warnings').replaceChildren(); $('warnings').hidden = !list?.length;
    for (const text of list || []) { const li = document.createElement('li'); li.textContent = String(text); $('warnings').append(li); }
  }
  const countText = () => `감지된 페이지: ${frames.length}개 · 출력 선택: ${selected.size}개`;
  function render() {
    $('pages').replaceChildren(); $('count').textContent = countText();
    frames.forEach((frame, index) => {
      const card = document.createElement('li'); card.className = 'page-card';
      const heading = document.createElement('div'); heading.className = 'page-heading';
      const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(frame.id);
      check.addEventListener('change', () => { check.checked ? selected.add(frame.id) : selected.delete(frame.id); $('count').textContent = countText(); $('generate').disabled = busy || !selected.size; });
      label.append(check, document.createTextNode(`${index + 1}페이지`)); heading.append(label); card.append(heading);
      const thumb = document.createElement('div'); thumb.className = 'thumb'; thumb.dataset.id = frame.id;
      if (thumbUrls.has(frame.id)) { const img = document.createElement('img'); img.src = thumbUrls.get(frame.id); img.alt = `${index + 1}페이지 축소 미리보기`; thumb.append(img); }
      else thumb.textContent = '미리보기 그리는 중…';
      card.append(thumb);
      const name = document.createElement('p'); name.className = 'page-name'; name.textContent = [frame.number, frame.name].filter(Boolean).join(' · ') || (frame.source === 'Layout' ? frame.id : '이름 없는 도곽'); card.append(name);
      const meta = document.createElement('p'); meta.className = 'page-meta'; meta.textContent = `${frame.source} · ${frame.width.toFixed(1)} × ${frame.height.toFixed(1)}${frame.source === 'Layout' ? ' mm' : ' 도면 단위'}`; card.append(meta);
      const actions = document.createElement('div'); actions.className = 'page-actions';
      const button = (text, callback, disabled = false) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.disabled = String(disabled); b.disabled = busy || disabled; b.addEventListener('click', callback); actions.append(b); };
      button('PDF 미리보기', () => preview(frame, index));
      button('↑ 앞으로', () => { [frames[index - 1], frames[index]] = [frames[index], frames[index - 1]]; render(); }, index === 0);
      button('↓ 뒤로', () => { [frames[index + 1], frames[index]] = [frames[index], frames[index + 1]]; render(); }, index === frames.length - 1);
      card.append(actions); $('pages').append(card);
    });
    $('generate').disabled = busy || !selected.size;
    drawThumbnails();
  }
  // 미리보기는 화면에 보이는 카드만, 한 장씩 그림. PDF를 만드는 동안은 멈춤
  const thumbQueue = new Set();
  let pumping = false;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && !thumbUrls.has(entry.target.dataset.id)) thumbQueue.add(entry.target.dataset.id);
    void pumpThumbnails();
  }, { rootMargin: '600px 0px' });
  function showThumb(id, url) {
    const box = $('pages').querySelector(`.thumb[data-id="${id}"]`);
    if (!box) return;
    if (!url) { box.textContent = '미리보기를 그리지 못했습니다.'; return; }
    const img = document.createElement('img'); img.src = url; img.alt = '축소 미리보기'; box.replaceChildren(img);
  }
  async function pumpThumbnails() {
    if (pumping) return;
    pumping = true;
    const runId = thumbRun, mono = $('mono').checked;
    try {
      while (thumbQueue.size && !busy && runId === thumbRun) {
        const id = frames.find(f => thumbQueue.has(f.id))?.id;
        if (!id) { thumbQueue.clear(); break; }
        thumbQueue.delete(id);
        try {
          const svg = await run('thumbnail', { page: id, mono });
          if (runId !== thumbRun) break;
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); thumbUrls.set(id, url); showThumb(id, url);
        } catch { if (runId === thumbRun) showThumb(id, null); }
      }
    } finally { pumping = false; }
  }
  function drawThumbnails() {
    observer.disconnect();
    for (const box of $('pages').querySelectorAll('.thumb')) if (!thumbUrls.has(box.dataset.id)) observer.observe(box);
  }
  async function makePdf(ids, paper) {
    const { bytes, skipped } = await run('pdf', { pages: ids, paper, mono: $('mono').checked });
    const blob = new Blob([bytes], { type: 'application/pdf' }); blob.skipped = skipped;
    return blob;
  }
  function disposePreview() { $('preview-frame').src = 'about:blank'; revoke(previewUrl); previewUrl = null; $('preview-link').removeAttribute('href'); }
  async function preview(frame, index) {
    disposePreview();
    $('preview-title').textContent = `${index + 1}페이지 미리보기`; $('preview-status').textContent = 'PDF를 만들고 있습니다.';
    $('preview-frame').hidden = true; $('preview-link').hidden = true; $('preview-dialog').showModal();
    try {
      const blob = await makePdf([frame.id], $('output-paper').value);
      if (!$('preview-dialog').open) return;
      previewUrl = URL.createObjectURL(blob); $('preview-frame').src = previewUrl; $('preview-link').href = previewUrl;
      $('preview-frame').hidden = false; $('preview-link').hidden = false; $('preview-status').textContent = 'PDF가 표시되지 않으면 새 창에서 열어주세요.';
    } catch (err) { $('preview-status').textContent = err.message; }
  }

  $('drawing').addEventListener('change', () => { $('drawing-name').textContent = $('drawing').files[0]?.name || '선택한 파일 없음'; });
  $('reference').addEventListener('change', () => { $('reference-name').textContent = $('reference').files[0]?.name || '선택하지 않으면 자동 검출'; });
  $('space').addEventListener('change', () => { const layoutOption = $('paper').querySelector('[value="layout"]'); layoutOption.disabled = $('space').value !== 'layouts'; $('reference').disabled = $('space').value === 'layouts'; if (layoutOption.disabled && $('paper').value === 'layout') $('paper').value = 'A3'; });
  $('space').dispatchEvent(new Event('change'));
  $('upload-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!ready || busy) return;
    const file = $('drawing').files[0];
    if (!file || !/\.(dwg|dxf)$/i.test(file.name)) return message('DWG 또는 DXF 도면 파일을 선택하세요.', true);
    const refFile = $('space').value === 'model' ? $('reference').files[0] : null;
    if (refFile && !/\.(dwg|dxf)$/i.test(refFile.name)) return message('기준 도곽 파일은 DWG 또는 DXF여야 합니다.', true);
    mode = $('space').value; fileName = file.name.replace(/\.(dwg|dxf)$/i, '') || 'drawing';
    const paper = $('paper').value;
    toggleBusy(true); message('도면을 읽고 있습니다…');
    try {
      const buffer = await file.arrayBuffer(), refBuffer = refFile ? await refFile.arrayBuffer() : null;
      const reference = refBuffer ? { file: refBuffer, name: refFile.name } : null;
      const result = await run('analyze', { file: buffer, name: file.name, mode, reference }, refBuffer ? [buffer, refBuffer] : [buffer]);
      frames = result.pages; initialOrder = frames.map(f => f.id); selected = new Set(initialOrder);
      $('output-paper').value = paper; $('output-paper').querySelector('[value="layout"]').disabled = mode !== 'layouts';
      warnings(result.warnings); $('review').hidden = false;
      const basis = result.reference ? `기준 도곽(${result.reference.names.join(', ') || '형상'} · ${result.reference.width.toFixed(0)} × ${result.reference.height.toFixed(0)})과 같은 ` : '';
      message(frames.length ? `${basis}${frames.length}개 페이지를 찾았습니다. 미리보기를 확인하세요.` : '출력할 페이지를 찾지 못했습니다.', !frames.length);
      toggleBusy(false); render(); setStep('review');
      $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { frames = []; $('review').hidden = true; toggleBusy(false); message(err.message, true); }
  });
  $('generate').addEventListener('click', async () => {
    if (busy || !selected.size) return;
    toggleBusy(true); message('PDF를 만들고 있습니다…');
    try {
      const ids = frames.filter(f => selected.has(f.id)).map(f => f.id);
      const blob = await makePdf(ids, $('output-paper').value);
      revoke(pdfUrl); pdfUrl = URL.createObjectURL(blob);
      $('download-info').textContent = `${ids.length}페이지 · ${blob.size < 1048576 ? `${Math.ceil(blob.size / 1024)} KB` : `${(blob.size / 1048576).toFixed(1)} MB`}${blob.skipped ? ` · 손상되어 그리지 못한 객체 ${blob.skipped}개 제외` : ''}`;
      $('download-panel').hidden = false; message(''); setStep('download');
    } catch (err) { message(err.message, true); }
    finally { toggleBusy(false); void pumpThumbnails(); }
  });
  $('download').addEventListener('click', () => { if (!pdfUrl) return; const a = document.createElement('a'); a.href = pdfUrl; a.download = `${fileName}.pdf`; document.body.append(a); a.click(); a.remove(); });
  $('reset-order').addEventListener('click', () => { frames.sort((a, b) => initialOrder.indexOf(a.id) - initialOrder.indexOf(b.id)); render(); });
  $('cancel').addEventListener('click', reset);
  $('close-preview').addEventListener('click', () => $('preview-dialog').close()); $('preview-dialog').addEventListener('close', disposePreview);

  run('init').then(() => {
    ready = true; $('engine-status').textContent = '변환 도구 준비 완료 · 도면은 이 브라우저 안에서만 처리됩니다.'; toggleBusy(false);
  }, err => { $('engine-status').textContent = `변환 도구를 불러오지 못했습니다: ${err.message}`; });
})();
