import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// `captureRequestError` attend TROIS arguments : l'erreur, la requête, et le
// contexte de route que Next fournit (routerKind, routePath, routeType). Le
// troisième était reçu puis jeté — d'où l'erreur de typage qui traînait depuis
// l'installation de Sentry, et surtout un contexte de route absent des rapports
// d'erreur. Le type `Instrumentation.onRequestError` de Next donne les bonnes
// signatures sans qu'on les recopie à la main.
// Au passage : le module était importé DEUX fois, et le second import prenait
// `.default` — or `captureRequestError` est un export nommé.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const Sentry = await import("@sentry/nextjs")
  Sentry.captureRequestError(err, request, context)
}