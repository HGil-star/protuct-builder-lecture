export function orderFrames(frames) {
  const sorted = [...frames].sort((a, b) => b.center[1] - a.center[1] || a.center[0] - b.center[0]);
  const rows = [];
  for (const frame of sorted) {
    const height = frame.height || 1;
    let row = rows.find(r => Math.abs(r.y - frame.center[1]) <= Math.min(r.height, height) * 0.25);
    if (!row) rows.push(row = { y: frame.center[1], height, items: [] });
    row.items.push(frame);
  }
  return rows.flatMap(r => r.items.sort((a, b) => a.center[0] - b.center[0] || a.id.localeCompare(b.id)));
}

export function validateSelection(body, frames) {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200 || new Set(body.ids).size !== body.ids.length)
    throw new Error('출력할 페이지를 중복 없이 선택하세요.');
  const known = new Set(frames.map(f => f.id));
  if (body.ids.some(id => typeof id !== 'string' || !known.has(id))) throw new Error('유효하지 않은 페이지입니다.');
  if (!['A4', 'A3', 'A2', 'A1', 'layout'].includes(body.paper)) throw new Error('용지 설정이 유효하지 않습니다.');
  return { ids: body.ids, paper: body.paper };
}
