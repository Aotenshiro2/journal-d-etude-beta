import * as Sentry from "@sentry/nextjs";
import { masquerSecretMcp } from "./src/lib/sentry-masque";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Le secret du connecteur MCP de ChatGPT est dans l'URL (/api/mcp/<secret>) : masque avant tout envoi.
  beforeSend: (evenement) => masquerSecretMcp(evenement),
  beforeSendTransaction: (evenement) => masquerSecretMcp(evenement),
});
