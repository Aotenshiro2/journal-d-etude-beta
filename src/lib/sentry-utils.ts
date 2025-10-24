import * as Sentry from '@sentry/nextjs';

/**
 * Utilitaires pour le monitoring Sentry spécifique à Journal d'Études
 */

// Types pour le contexte de l'application
export interface CanvasContext {
  canvasId: string;
  noteCount: number;
  connectionCount: number;
  userAction: string;
}

export interface NoteContext {
  noteId: string;
  contentLength: number;
  hasImage: boolean;
  conceptsCount: number;
}

/**
 * Capturer une erreur avec contexte spécifique au canvas
 */
export function captureCanvasError(error: Error, context: CanvasContext) {
  return Sentry.captureException(error, {
    tags: {
      component: 'canvas',
      canvas_id: context.canvasId,
      user_action: context.userAction,
    },
    extra: {
      note_count: context.noteCount,
      connection_count: context.connectionCount,
      timestamp: new Date().toISOString(),
    },
    level: 'error'
  });
}

/**
 * Capturer une erreur avec contexte spécifique aux notes
 */
export function captureNoteError(error: Error, context: NoteContext) {
  return Sentry.captureException(error, {
    tags: {
      component: 'note-editor',
      note_id: context.noteId,
      has_image: context.hasImage.toString(),
    },
    extra: {
      content_length: context.contentLength,
      concepts_count: context.conceptsCount,
      timestamp: new Date().toISOString(),
    },
    level: 'error'
  });
}

/**
 * Tracer les performances des opérations canvas
 */
export function traceCanvasOperation<T>(
  operationName: string,
  operation: () => T | Promise<T>,
  context?: Partial<CanvasContext>
): Promise<T> | T {
  return Sentry.startSpan({
    name: `canvas.${operationName}`,
    op: 'canvas.operation',
    attributes: {
      ...context,
      component: 'canvas'
    }
  }, operation);
}

/**
 * Tracer les performances des opérations de notes
 */
export function traceNoteOperation<T>(
  operationName: string,
  operation: () => T | Promise<T>,
  context?: Partial<NoteContext>
): Promise<T> | T {
  return Sentry.startSpan({
    name: `note.${operationName}`,
    op: 'note.operation',
    attributes: {
      ...context,
      component: 'note-editor'
    }
  }, operation);
}

/**
 * Tracer les performances des requêtes API
 */
export function traceApiCall<T>(
  endpoint: string,
  method: string,
  operation: () => T | Promise<T>
): Promise<T> | T {
  return Sentry.startSpan({
    name: `api.${method}.${endpoint}`,
    op: 'http.client',
    attributes: {
      endpoint,
      method,
      component: 'api'
    }
  }, operation);
}

/**
 * Breadcrumb pour les actions utilisateur importantes
 */
export function addUserActionBreadcrumb(action: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    message: `User action: ${action}`,
    category: 'user.action',
    level: 'info',
    data: {
      action,
      timestamp: Date.now(),
      ...data
    }
  });
}

/**
 * Breadcrumb pour les interactions canvas
 */
export function addCanvasBreadcrumb(action: string, canvasData?: Partial<CanvasContext>) {
  Sentry.addBreadcrumb({
    message: `Canvas: ${action}`,
    category: 'canvas.interaction', 
    level: 'info',
    data: {
      action,
      timestamp: Date.now(),
      ...canvasData
    }
  });
}

/**
 * Breadcrumb pour les opérations sur les notes
 */
export function addNoteBreadcrumb(action: string, noteData?: Partial<NoteContext>) {
  Sentry.addBreadcrumb({
    message: `Note: ${action}`,
    category: 'note.operation',
    level: 'info', 
    data: {
      action,
      timestamp: Date.now(),
      ...noteData
    }
  });
}

/**
 * Définir le contexte utilisateur (pour les futures implémentations d'auth)
 */
export function setUserContext(userId: string, userInfo?: Record<string, any>) {
  Sentry.setUser({
    id: userId,
    ...userInfo
  });
}

/**
 * Définir des tags personnalisés pour une session
 */
export function setSessionTags(tags: Record<string, string>) {
  Sentry.setTags(tags);
}

/**
 * Capturer des métriques de performance personnalisées
 */
export function capturePerformanceMetric(
  metricName: string,
  value: number,
  unit: string,
  tags?: Record<string, string>
) {
  Sentry.captureMessage(`Performance metric: ${metricName}`, {
    level: 'info',
    tags: {
      metric_name: metricName,
      metric_unit: unit,
      ...tags
    },
    extra: {
      metric_value: value,
      timestamp: new Date().toISOString()
    }
  });
}