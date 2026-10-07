import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('unconfigured server disables analysis on desktop and mobile without horizontal overflow', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DWG → PDF 변환', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('navigation')).not.toContainText('로또');
  await expect(page.getByRole('button', { name: '도면 분석' })).toBeDisabled();
  await expect(page.locator('#server-status')).toContainText('준비 중');
  await page.screenshot({ path: 'test-results/dwg-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/dwg-mobile.png', fullPage: true });
  await page.goto('/dwg-pdf.html');
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.getByRole('heading', { name: 'DWG → PDF 변환', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('static hosting HTML fallback and malformed health responses show a clear unavailable state', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const response of [
    { status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><body>Static homepage fallback</body></html>' },
    { status: 200, contentType: 'application/json', body: '{ invalid json' },
    { status: 200, json: { ready: true } }
  ]) {
    await page.route('**/api/dwg/health', route => route.fulfill(response));
    await page.goto('/index.html');
    await expect(page.locator('#server-status')).toContainText('아직 변환 서비스가 연결되지 않았습니다');
    await expect(page.locator('#server-status')).not.toContainText('Unexpected');
    await expect(page.getByRole('button', { name: '도면 분석', exact: true })).toBeDisabled();
    await page.unroute('**/api/dwg/health');
  }
  expect(errors).toEqual([]);
});

test('user can upload, inspect, reorder, exclude pages, change paper and request a PDF', async ({ page }) => {
  let state = 'review', selection;
  const pdf = await PDFDocument.create(); pdf.addPage([200, 100]); const pdfBytes = Buffer.from(await pdf.save());
  await page.route('**/api/dwg/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/health')) return route.fulfill({ json: { ready: true, maxUploadMB: 100, retentionMinutes: 60 } });
    if (pathname.endsWith('/jobs')) return route.fulfill({ status: 202, json: { id: 'mock', token: 'test-only' } });
    if (pathname.endsWith('/generate')) { selection = route.request().postDataJSON(); state = 'done'; return route.fulfill({ status: 202, json: { state: 'generating' } }); }
    if (pathname.includes('/pages/')) return route.fulfill({ contentType: 'application/pdf', body: pdfBytes });
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    return route.fulfill({ json: { state, message: state === 'review' ? '테스트 도곽' : '테스트 PDF 준비', frames: [{ id: 'left', name: 'Frame L', source: 'Block', center: [0, 0], width: 200, height: 100 }, { id: 'right', name: 'Frame R', source: 'XREF', center: [200, 0], width: 200, height: 100 }], warnings: ['테스트용 응답'], pageCount: 1, expires: Date.now() + 60000 } });
  });
  await page.goto('/index.html');
  await page.locator('#reference').setInputFiles({ name: '기준 도곽.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1032') });
  await page.locator('#drawing').setInputFiles({ name: '실제 도면.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1032') });
  await expect(page.locator('#reference-name')).toContainText('기준 도곽.dwg');
  await page.getByRole('button', { name: '도면 분석', exact: true }).click();
  await expect(page.locator('#pages > li')).toHaveCount(2);
  await page.getByRole('button', { name: 'PDF 미리보기' }).first().click();
  await expect(page.locator('#preview-link')).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '↓ 뒤로' }).first().click();
  await expect(page.locator('#pages > li').first().locator('.page-name')).toHaveText('Frame R');
  await page.getByRole('checkbox', { name: '2페이지' }).uncheck();
  await expect(page.locator('#count')).toContainText('출력 선택: 1개');
  await page.locator('#output-paper').selectOption('A1');
  await page.getByRole('button', { name: 'PDF 생성', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PDF 다운로드', exact: true })).toBeVisible();
  expect(selection).toEqual({ ids: ['right'], paper: 'A1' });
  await page.getByRole('button', { name: '결과 삭제' }).click();
  await expect(page.getByRole('button', { name: '도면 분석', exact: true })).toBeEnabled();
  await expect(page.locator('#message')).toContainText('삭제했습니다');
});
