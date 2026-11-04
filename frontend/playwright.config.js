import { defineConfig } from '@playwright/test'

const remoto = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: remoto || 'http://localhost:5173',
    // O certificado do homelab é próprio; o deploy.sh já valida o TLS com o certificado raiz.
    ignoreHTTPSErrors: true,
  },
  webServer: remoto
    ? undefined
    : [
        {
          command: 'go run .',
          cwd: '../backend',
          env: { DATA_DIR: '../data' },
          url: 'http://localhost:8080/api/health',
          reuseExistingServer: true,
        },
        {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
        },
      ],
})
