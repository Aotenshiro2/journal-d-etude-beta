'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="max-w-md w-full bg-card p-6 rounded-lg shadow-lg border">
            <div className="text-center">
              <div className="text-destructive text-6xl mb-4">💥</div>
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Erreur Globale
              </h1>
              <p className="text-muted-foreground mb-6">
                Une erreur critique s'est produite dans l'application.
                Notre équipe a été automatiquement notifiée.
              </p>
              <div className="space-y-3">
                <button
                  onClick={reset}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md transition-colors"
                >
                  Réessayer
                </button>
                <button
                  onClick={() => window.location.href = '/'}
                  className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md transition-colors"
                >
                  Retour à l'accueil
                </button>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}