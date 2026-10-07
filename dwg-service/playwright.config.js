import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-test',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium' },
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:3100/api/dwg/health', reuseExistingServer: false, env: { PORT: '3100', DWG_WORK_DIR: '/tmp/dwg-browser-test', APS_CLIENT_ID: '', APS_CLIENT_SECRET: '', APS_ACTIVITY_ID: '' } }
});
