'use client';

import { useState } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function TestSentryPage() {
  const [loading, setLoading] = useState(false);

  const testErrorCapture = () => {
    try {
      throw new Error('Test error from Journal d\'Études - Error capturing works!');
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          section: 'test-page',
          component: 'error-test'
        },
        extra: {
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent
        }
      });
      alert('Erreur capturée et envoyée à Sentry!');
    }
  };

  const testPerformanceTransaction = async () => {
    setLoading(true);
    
    const transaction = Sentry.startSpan({
      name: 'test-performance-transaction',
      op: 'navigation'
    }, async () => {
      // Simuler une opération qui prend du temps
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simuler des opérations de base de données
      const dbSpan = Sentry.startInactiveSpan({
        name: 'simulate-database-query',
        op: 'db.query'
      });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      dbSpan?.end();
      
      return 'Performance test completed';
    });
    
    setLoading(false);
    alert('Transaction de performance terminée!');
  };

  const testCustomMetrics = () => {
    // Envoyer des événements personnalisés au lieu de métriques
    Sentry.captureMessage('Custom metric: Button clicked', {
      level: 'info',
      tags: {
        page: 'test-sentry',
        action: 'custom-metrics',
        metric_type: 'button_click'
      },
      extra: {
        performance_score: Math.random() * 100,
        timestamp: new Date().toISOString()
      }
    });

    alert('Événements personnalisés envoyés!');
  };

  const testBreadcrumbs = () => {
    Sentry.addBreadcrumb({
      message: 'User clicked test breadcrumbs button',
      category: 'ui.click',
      level: 'info',
      data: {
        component: 'TestSentryPage',
        timestamp: Date.now()
      }
    });

    Sentry.addBreadcrumb({
      message: 'Simulating user navigation',
      category: 'navigation',
      level: 'info'
    });

    // Déclencher une erreur pour voir les breadcrumbs
    setTimeout(() => {
      try {
        throw new Error('Test error with breadcrumbs context');
      } catch (error) {
        Sentry.captureException(error);
        alert('Erreur avec contexte breadcrumbs envoyée!');
      }
    }, 1000);

    alert('Breadcrumbs ajoutés, erreur sera déclenchée dans 1 seconde...');
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-8">
          Test Sentry Integration - Journal d'Études
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Error Capture</h2>
            <p className="text-muted-foreground mb-4">
              Test la capture et l'envoi d'erreurs vers Sentry
            </p>
            <button
              onClick={testErrorCapture}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 px-4 py-2 rounded-md transition-colors"
            >
              Déclencher une erreur
            </button>
          </div>

          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Performance Monitoring</h2>
            <p className="text-muted-foreground mb-4">
              Test le monitoring de performance avec transactions
            </p>
            <button
              onClick={testPerformanceTransaction}
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-4 py-2 rounded-md transition-colors"
            >
              {loading ? 'Test en cours...' : 'Test Performance'}
            </button>
          </div>

          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Custom Events</h2>
            <p className="text-muted-foreground mb-4">
              Test l'envoi d'événements personnalisés
            </p>
            <button
              onClick={testCustomMetrics}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md transition-colors"
            >
              Envoyer Événements
            </button>
          </div>

          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Breadcrumbs Context</h2>
            <p className="text-muted-foreground mb-4">
              Test le système de breadcrumbs pour le contexte
            </p>
            <button
              onClick={testBreadcrumbs}
              className="bg-accent text-accent-foreground hover:bg-accent/80 px-4 py-2 rounded-md transition-colors"
            >
              Test Breadcrumbs
            </button>
          </div>
        </div>

        <div className="mt-8 bg-card p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-4">Instructions</h2>
          <div className="space-y-2 text-muted-foreground">
            <p>1. Assurez-vous que NEXT_PUBLIC_SENTRY_DSN est configuré dans .env.local</p>
            <p>2. Cliquez sur les boutons pour tester différentes fonctionnalités</p>
            <p>3. Vérifiez dans votre dashboard Sentry que les événements sont bien reçus</p>
            <p>4. Cette page sera supprimée en production</p>
          </div>
        </div>
      </div>
    </div>
  );
}