export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(err: unknown, request: Request, context: unknown) {
  await import("@sentry/nextjs");
  const Sentry = (await import("@sentry/nextjs")).default;
  
  Sentry.captureRequestError(err, request);
}