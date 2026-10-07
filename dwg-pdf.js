(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = (window.DWG_PDF_CONFIG?.apiBase || '').replace(/\/$/, '');
  let ready = false, job = null, frames = [], initialOrder = [], selected = new Set(), polling = false, busy = false, previewUrl = null, previewRequest = 0;
  const blobs = new Map();
  const message = (text, isError = false) => { $('message').textContent = text; $('message').classList.toggle('error', isError); };
  const endpoint = suffix => `${base}/api/dwg${suffix}`;
  function setStep(step) { for (const name of ['upload', 'review', 'download']) { if (name === step) $(`step-${name}`).setAttribute('aria-current', 'step'); else $(`step-${name}`).removeAttribute('aria-current'); } }
  async function request(suffix, options = {}) {
    const response = await fetch(endpoint(suffix), { ...options, headers: { ...(job ? { 'X-Job-Token': job.token } : {}), ...options.headers } });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `요청 실패 (${response.status})`); }
    return response;
  }
  function toggleBusy(value) {
    busy = value; $('upload-fields').disabled = value || Boolean(job); $('analyze').disabled = value || !ready || Boolean(job);
    $('generate').disabled = value || !selected.size; $('reset-order').disabled = value;
    $('output-paper').disabled = value; $('cancel').hidden = !job; $('cancel').disabled = false;
    for (const input of $('pages').querySelectorAll('button,input')) input.disabled = value;
  }
  function disposePreview() { previewRequest++; $('preview-frame').src = 'about:blank'; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; $('preview-link').removeAttribute('href'); }
  function reset() {
    polling = false; disposePreview(); if ($('preview-dialog').open) $('preview-dialog').close();
    job = null; frames = []; initialOrder = []; selected.clear(); blobs.clear();
    $('review').hidden = true; $('download-panel').hidden = true; $('pages').replaceChildren();
    $('retry-status').hidden = true;
    toggleBusy(false); setStep('upload');
  }
  async function removeJob() {
    if (!job) return;
    $('cancel').disabled = true; $('delete').disabled = true;
    try { await request(`/jobs/${job.id}`, { method: 'DELETE' }); reset(); message('작업과 서버 파일을 삭제했습니다.'); }
    catch (err) { message(`${err.message}\n연결이 복구되면 다시 삭제할 수 있습니다. 파일은 작업 만료 시 자동 삭제됩니다.`, true); }
    finally { $('cancel').disabled = false; $('delete').disabled = false; }
  }
  function warnings(list) {
    $('warnings').replaceChildren(); $('warnings').hidden = !list?.length;
    for (const text of list || []) { const li = document.createElement('li'); li.textContent = String(text); $('warnings').append(li); }
  }
  function render() {
    $('pages').replaceChildren();
    $('count').textContent = `감지된 페이지: ${frames.length}개 · 출력 선택: ${selected.size}개`;
    frames.forEach((frame, index) => {
      const card = document.createElement('li'); card.className = 'page-card';
      const heading = document.createElement('div'); heading.className = 'page-heading';
      const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(frame.id); check.disabled = busy;
      check.addEventListener('change', () => { check.checked ? selected.add(frame.id) : selected.delete(frame.id); $('count').textContent = `감지된 페이지: ${frames.length}개 · 출력 선택: ${selected.size}개`; $('generate').disabled = busy || !selected.size; });
      label.append(check, document.createTextNode(`${index + 1}페이지`)); heading.append(label); card.append(heading);
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 260 130'); svg.classList.add('frame-map'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '도곽 종횡비 표시. 실제 도면은 PDF 미리보기로 확인하세요.');
      const ratio = frame.width / frame.height, w = Math.min(220, 96 * ratio), h = w / ratio;
      for (const inset of [0, 5]) { const rect = document.createElementNS(ns, 'rect'); rect.setAttribute('x', String((260 - w) / 2 + inset)); rect.setAttribute('y', String((130 - h) / 2 + inset)); rect.setAttribute('width', String(Math.max(w - inset * 2, 1))); rect.setAttribute('height', String(Math.max(h - inset * 2, 1))); if (inset) rect.classList.add('frame-inner'); svg.append(rect); }
      card.append(svg);
      const name = document.createElement('p'); name.className = 'page-name'; name.textContent = frame.name || frame.id; card.append(name);
      const meta = document.createElement('p'); meta.className = 'page-meta'; meta.textContent = `${frame.source || '도곽'} · ${frame.width.toFixed(1)} × ${frame.height.toFixed(1)}${frame.source === 'Layout' ? ' mm' : ' 도면 단위'}${frame.confidence ? ` · ${frame.confidence}` : ''}`; card.append(meta);
      const actions = document.createElement('div'); actions.className = 'page-actions';
      const button = (text, callback, disabled = false) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.disabled = busy || disabled; b.addEventListener('click', callback); actions.append(b); };
      button('PDF 미리보기', () => preview(frame, index));
      button('↑ 앞으로', () => { [frames[index - 1], frames[index]] = [frames[index], frames[index - 1]]; render(); }, index === 0);
      button('↓ 뒤로', () => { [frames[index + 1], frames[index]] = [frames[index], frames[index + 1]]; render(); }, index === frames.length - 1);
      card.append(actions); $('pages').append(card);
    });
    $('generate').disabled = busy || !selected.size;
  }
  async function preview(frame, index) {
    disposePreview(); const requestId = previewRequest; const activeJob = job;
    $('preview-title').textContent = `${index + 1}페이지 미리보기`; $('preview-status').textContent = 'PDF를 불러오고 있습니다.';
    $('preview-frame').hidden = true; $('preview-link').hidden = true; $('preview-dialog').showModal();
    try {
      let blob = blobs.get(frame.id);
      if (!blob) { blob = await (await request(`/jobs/${job.id}/pages/${frame.id}`)).blob(); if (requestId !== previewRequest || job !== activeJob) return; blobs.set(frame.id, blob); }
      if (requestId !== previewRequest || job !== activeJob) return;
      previewUrl = URL.createObjectURL(blob); $('preview-frame').src = previewUrl; $('preview-link').href = previewUrl;
      $('preview-frame').hidden = false; $('preview-link').hidden = false; $('preview-status').textContent = '분석 시 설정한 용지의 미리보기입니다. PDF가 표시되지 않으면 새 창에서 열어주세요.';
    } catch (err) { if (requestId === previewRequest) $('preview-status').textContent = err.message; }
  }
  async function poll() {
    if (polling) return; polling = true; const activeJob = job;
    try {
      while (job === activeJob && job) {
        const data = await (await request(`/jobs/${job.id}`)).json(); if (job !== activeJob) break;
        message(data.message, ['failed', 'empty'].includes(data.state));
        if (data.state === 'review') {
          frames = data.frames; initialOrder = frames.map(f => f.id); selected = new Set(initialOrder);
          warnings(data.warnings); $('review').hidden = false; toggleBusy(false); render(); setStep('review'); break;
        }
        if (data.state === 'done') {
          warnings(data.warnings); $('review').hidden = false; $('download-panel').hidden = false;
          $('download-info').textContent = `${data.pageCount}페이지 · ${new Date(data.expires).toLocaleTimeString('ko-KR')}까지 다운로드 가능`;
          toggleBusy(true); $('download').disabled = false; setStep('download'); break;
        }
        if (['failed', 'empty'].includes(data.state)) { toggleBusy(true); break; }
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    } catch (err) { if (job === activeJob) { message(`${err.message}\n페이지를 닫기 전 작업을 삭제하거나, 아래 버튼으로 상태를 다시 확인하세요.`, true); $('retry-status').hidden = false; } }
    finally { polling = false; }
  }
  const retry = document.createElement('button'); retry.id = 'retry-status'; retry.type = 'button'; retry.hidden = true; retry.textContent = '작업 상태 다시 확인'; $('message').after(retry);
  retry.addEventListener('click', () => { retry.hidden = true; void poll(); });
  for (const name of ['reference', 'drawing']) $(name).addEventListener('change', () => { $(`${name}-name`).textContent = $(name).files[0]?.name || '선택한 파일 없음'; });
  $('space').addEventListener('change', () => { const layoutOption = $('paper').querySelector('[value="layout"]'); layoutOption.disabled = $('space').value !== 'layouts'; if (layoutOption.disabled && $('paper').value === 'layout') $('paper').value = 'A3'; });
  $('space').dispatchEvent(new Event('change'));
  $('upload-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!ready || busy || job) return;
    const formData = new FormData($('upload-form'));
    for (const name of ['reference', 'drawing']) if (!$(name).files[0] || !/\.dwg$/i.test($(name).files[0].name)) return message('기준 도곽과 실제 도면 DWG를 선택하세요.', true);
    if (!$('dependencies').files.length) formData.delete('dependencies');
    const paper = $('paper').value; const space = $('space').value;
    toggleBusy(true); message('파일을 업로드하고 있습니다.');
    try {
      job = await (await request('/jobs', { method: 'POST', body: formData })).json();
      $('output-paper').value = paper; $('output-paper').querySelector('[value="layout"]').disabled = space !== 'layouts';
      toggleBusy(true); void poll();
    } catch (err) { toggleBusy(false); message(err.message, true); }
  });
  $('generate').addEventListener('click', async () => {
    if (busy || !job || !selected.size) return;
    toggleBusy(true); message('PDF 생성을 요청하고 있습니다.');
    try { await request(`/jobs/${job.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: frames.filter(f => selected.has(f.id)).map(f => f.id), paper: $('output-paper').value }) }); void poll(); }
    catch (err) { toggleBusy(false); render(); message(err.message, true); }
  });
  $('reset-order').addEventListener('click', () => { frames.sort((a, b) => initialOrder.indexOf(a.id) - initialOrder.indexOf(b.id)); render(); });
  $('cancel').addEventListener('click', removeJob); $('delete').addEventListener('click', removeJob);
  $('close-preview').addEventListener('click', () => $('preview-dialog').close()); $('preview-dialog').addEventListener('close', disposePreview);
  $('download').addEventListener('click', async () => {
    $('download').disabled = true;
    try { const blob = await (await request(`/jobs/${job.id}/download`)).blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'drawing.pdf'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (err) { message(err.message, true); } finally { $('download').disabled = false; }
  });
  async function connect() {
    try {
      if (base && !/^https:\/\//.test(base) && !/^http:\/\/localhost(?::\d+)?$/.test(base)) throw new Error('API 주소 설정을 확인하세요.');
      const response = await fetch(endpoint('/health'), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('변환 서버에 연결할 수 없습니다.');
      const health = await response.json(); ready = health.ready === true;
      $('server-status').textContent = ready ? `변환 서버 연결됨 · 파일당 최대 ${health.maxUploadMB} MB` : '변환 서버 준비 중입니다. APS 연결 설정이 완료되면 도면을 분석할 수 있습니다.';
      $('retention').textContent = `업로드 파일은 최종 변환 완료 후 삭제합니다. 분석 대기 파일과 PDF도 작업 시작 후 최대 ${health.retentionMinutes}분 내 만료되며, 만료 후 정리됩니다.`;
      toggleBusy(false);
    } catch (err) { ready = false; $('server-status').textContent = `변환 서버 연결이 필요합니다. ${err.message} 서버 설정 후 이 페이지를 새로고침하세요.`; toggleBusy(false); }
  }
  void connect();
})();
