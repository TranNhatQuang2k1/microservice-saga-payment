import Fastify from 'fastify';
import { app } from './app/app.js';
import { loadServerConfig } from '@org/configurations';
import pino from 'pino';

const serverCfg = loadServerConfig();
const host = '0.0.0.0';
const port = serverCfg.http.port;

const startServer = async () => {
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info',
    // Dùng redact để che đi các trường nhạy cảm
    redact: {
      paths: ['body.password', 'password', 'req.body.password'],
      censor: '***[HIDDEN]***'
    },
    transport: {
      target: 'pino-pretty', // chỉ dùng local dev
      options: {
        translateTime: 'SYS:standard', // Đổi timestamp thành giờ dễ đọc
        ignore: 'pid,reqId',  // Ẩn bớt các trường không cần thiết
      },
    },
   });
  const server = Fastify({
    loggerInstance: logger,
    ajv: {
      customOptions: {
        coerceTypes:          false, // don't silently cast 1 → "1"
        removeAdditional:     true,  // strip unknown fields from body
        useDefaults:          true,  // fill in schema default values
        allErrors:            true,  // report all validation errors, not just first
      },
    },
  });

  server.register(app);

  // Thêm hook này trước khi server.listen(...)
  server.addHook('preHandler', (request, reply, done) => {
    // Kiểm tra xem request có body không thì mới in
    if (request.body) {
      request.log.info({ body: request.body }, 'parsed request body');
    }
    done();
  });

  // Graceful shutdown
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down...`);
      try {
        // Close idle keep-alive connections so server.close() doesn't hang
        server.server.closeIdleConnections();

        // Force-close all remaining connections after timeout
        const forceClose = setTimeout(() => {
          server.log.warn('Shutdown timeout exceeded, force-closing all connections');
          server.server.closeAllConnections();
        }, SHUTDOWN_TIMEOUT_MS);
        forceClose.unref();

        await server.close(); // triggers onClose hooks (Redis quit, etc.)

        clearTimeout(forceClose);
        // Pino transport is closed after server.close() — use console for final message
        console.log(`[shutdown] Application closed on ${signal}`);
        process.exit(0);
      } catch (err) {
        console.error(`[shutdown] Error closing application on ${signal}:`, err);
        process.exit(1);
      }
    });
  });

  server.listen({ port, host }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    } else {
      console.log(`[ ready_kk ] http://${host}:${port}`);
    }
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
  });
}

startServer();
