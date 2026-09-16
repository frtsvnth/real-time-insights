import type { FastifyInstance } from 'fastify';
import type { SessionStore } from '../session/SessionStore.js';

export function registerHttpRoutes(app: FastifyInstance, sessionStore: SessionStore): void {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get<{ Params: { id: string } }>('/api/session/:id', async (request, reply) => {
    const session = sessionStore.get(request.params.id);
    if (!session) {
      reply.code(404);
      return { error: 'session_not_found' };
    }
    return session;
  });
}
