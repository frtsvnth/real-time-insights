import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { config } from './config.js';
import { registerHttpRoutes } from './http/health.js';
import { registerSessionSocket } from './ws/sessionSocket.js';
import { sessionStore } from './session/SessionStore.js';
import { WhisperSttProvider } from './stt/WhisperSttProvider.js';

const app = Fastify({ logger: true });
const sttProvider = new WhisperSttProvider();

await app.register(websocketPlugin);
registerHttpRoutes(app, sessionStore);
registerSessionSocket(app, sessionStore, sttProvider);

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`Real-time Insights server слушает на порту ${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
