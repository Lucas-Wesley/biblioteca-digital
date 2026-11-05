import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))

const ARQUIVO_DE_LIVRO = /^\/api\/books\/([^/]+)\/(file|cover|publication\/.+)$/

// Só devolve o que foi baixado de propósito. Guardar o que passa por aqui faria o livro
// aberto uma vez parecer disponível offline, pela metade.
registerRoute(
  ({ url, request }) => url.origin === location.origin && request.method === 'GET' && ARQUIVO_DE_LIVRO.test(url.pathname),
  async ({ url, request }) => {
    const id = decodeURIComponent(url.pathname.match(ARQUIVO_DE_LIVRO)[1])
    return (await caches.match(url.pathname, { cacheName: `livro-${id}` })) ?? fetch(request)
  },
)
