import { MetricsService, normalizeRouteForMetrics } from './metrics.service';
import * as repoDb from '@repo/database';

describe('normalizeRouteForMetrics', () => {
  it('normalizes query parameters', () => {
    expect(normalizeRouteForMetrics('/api/notes?limit=10&page=2')).toBe('/api/notes');
  });

  it('collapses numeric IDs', () => {
    expect(normalizeRouteForMetrics('/api/items/123')).toBe('/api/items/:id');
  });

  it('collapses long token/UUID-like IDs', () => {
    expect(
      normalizeRouteForMetrics('/api/notes/clh81234567890abcdef1234'),
    ).toBe('/api/notes/:id');
  });

  it('leaves short standard paths intact', () => {
    expect(normalizeRouteForMetrics('/api/health/live')).toBe('/api/health/live');
    expect(normalizeRouteForMetrics('/api/users/me/bootstrap')).toBe(
      '/api/users/me/bootstrap',
    );
  });
});

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('initializes meters and registers pool gauges on module init', () => {
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('records pool acquire error without throwing', () => {
    service.onModuleInit();
    expect(() => service.recordPoolAcquireError('timeout')).not.toThrow();
    expect(() => service.recordPoolAcquireError('connection_refused')).not.toThrow();
  });

  it('records http request and error metrics safely', () => {
    service.onModuleInit();
    expect(() =>
      service.recordHttpRequest('GET', '/api/notes', 200, 15),
    ).not.toThrow();
    expect(() =>
      service.recordHttpError('POST', '/api/notes', 'ValidationError'),
    ).not.toThrow();
  });

  it('records auth and notes operations safely', () => {
    service.onModuleInit();
    expect(() =>
      service.recordAuthEvent('sign_in', 'success', 'email'),
    ).not.toThrow();
    expect(() =>
      service.recordNoteOperation('create', 'success'),
    ).not.toThrow();
    expect(() => service.recordRateLimitHit('/api/auth/sign-in')).not.toThrow();
  });

  it('responds to pool error listener trigger', () => {
    let capturedListener: ((err: Error) => void) | undefined;
    jest.spyOn(repoDb, 'addPoolErrorListener').mockImplementation((listener) => {
      capturedListener = listener;
      return () => {};
    });

    service.onModuleInit();
    expect(capturedListener).toBeDefined();

    expect(() => {
      capturedListener?.(new Error('Connection terminated unexpectedly'));
    }).not.toThrow();
  });

  it('records audit queue metrics safely', () => {
    service.onModuleInit();
    expect(() =>
      service.recordAuditQueueEnqueue('note_created'),
    ).not.toThrow();
    expect(() =>
      service.recordAuditQueueProcessed('note_created', 0.045),
    ).not.toThrow();
    expect(() => service.recordAuditQueueRetry('note_created')).not.toThrow();
    expect(() =>
      service.recordAuditQueueFailed('note_created', false),
    ).not.toThrow();
    expect(() =>
      service.recordAuditQueueFailed('note_created', true),
    ).not.toThrow();
    expect(() => service.recordAuditQueueDepth(2)).not.toThrow();
    expect(() =>
      service.recordAuditQueueProcessingStatus(true),
    ).not.toThrow();
    expect(() =>
      service.recordAuditQueueProcessingStatus(false),
    ).not.toThrow();
    expect(() =>
      service.recordAuditQueueDrainDuration(0.12),
    ).not.toThrow();
    expect(() =>
      service.recordAuditQueuePurged(42, 0.31),
    ).not.toThrow();
    expect(() => service.recordAuditQueuePurged(0, 0.01)).not.toThrow();
  });
});

