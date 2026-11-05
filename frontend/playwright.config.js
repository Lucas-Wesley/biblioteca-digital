import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

const remoto = process.env.E2E_BASE_URL
// O teste local grava livros, então roda em portas e dados só dele, recriados a cada execução.
const dados = path.join(os.tmpdir(), 'biblioteca-e2e')

export default defineConfig({
  testDir: './e2e',
  // Os testes dividem o mesmo servidor e o mesmo banco de teste.
  workers: 1,
  use: {
    baseURL: remoto || 'http://localhost:5174',
    // O certificado do homelab é próprio; o deploy.sh já valida o TLS com o certificado raiz.
    ignoreHTTPSErrors: true,
  },
  webServer: remoto
    ? undefined
    : [
        {
          command: `rm -rf "${dados}" && mkdir -p "${dados}/books" && cp ../data/books/quincas-borba.epub "${dados}/books/" && go run .`,
          cwd: '../backend',
          env: { DATA_DIR: dados, ADDR: ':8090' },
          url: 'http://localhost:8090/api/health',
        },
        {
          // A versão de produção: é a única que tem service worker e, portanto, offline.
          command: 'npm run build && npx vite preview --port 5174 --strictPort',
          env: { API_URL: 'http://localhost:8090' },
          url: 'http://localhost:5174',
          timeout: 180000,
        },
      ],
})
