'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#030712', color: '#fff' }}>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💥</div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Une erreur est survenue</h1>
            <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>{error.message}</p>
            <button
              onClick={reset}
              style={{ padding: '0.5rem 1.5rem', background: '#fff', color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
