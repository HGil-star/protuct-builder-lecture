const REGION = process.env.APS_REGION || 'us-east';
if (!['us-east', 'eu-west'].includes(REGION)) throw new Error('APS_REGION 설정을 확인하세요.');
export const apiBase = `https://developer.api.autodesk.com/da/${REGION}/v3`;
let cached;
export const configured = () => Boolean(process.env.APS_CLIENT_ID && process.env.APS_CLIENT_SECRET && process.env.APS_ACTIVITY_ID && /^https:\/\//.test(process.env.PUBLIC_BASE_URL || ''));

export async function token() {
  if (cached && cached.until > Date.now()) return cached.value;
  const response = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${process.env.APS_CLIENT_ID}:${process.env.APS_CLIENT_SECRET}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'code:all' })
  });
  if (!response.ok) throw new Error(`APS 인증 실패 (${response.status}). 서버 설정을 확인하세요.`);
  const data = await response.json(); cached = { value: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 }; return cached.value;
}

export async function apsRequest(route, method = 'GET', body) {
  const response = await fetch(`${apiBase}${route}`, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`APS 요청 실패 (${response.status}). Activity·권한·사용량 설정을 확인하세요.`);
  return response.status === 204 ? null : response.json();
}
