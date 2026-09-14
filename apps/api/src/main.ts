import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnvironment } from '@splito/config';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { applyOpenApiContract } from './openapi-contract.js';

const config = loadEnvironment();
const adapter = new FastifyAdapter({
  bodyLimit: 1_000_000,
  trustProxy: config.TRUST_PROXY,
  requestIdHeader: 'x-request-id',
  genReqId: () => randomUUID(),
  logger: {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'password',
        '*.password',
        'otp',
        '*.otp',
        'developmentOtp',
        '*.developmentOtp',
        'mobileNumber',
        '*.mobileNumber',
        '*.token',
        '*.secret',
        'MONGODB_URI',
        '*.MONGODB_URI',
        '*.uri',
        '*.connectionString',
      ],
      censor: '[REDACTED]',
    },
  },
});

adapter.getInstance().addHook('onRequest', (request, reply, done) => {
  void reply.header('x-request-id', request.id);
  done();
});

const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
  bufferLogs: true,
});

await app.register(cookie);
await app.register(multipart, {
  attachFieldsToBody: false,
  throwFileSizeLimit: true,
  limits: {
    fieldNameSize: 100,
    fieldSize: 1,
    fields: 0,
    fileSize: Math.min(config.MAX_UPLOAD_BYTES, 10_000_000),
    files: 1,
    headerPairs: 50,
    parts: 1,
  },
});
await app.register(cors, {
  origin: config.WEB_ORIGIN,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'if-match', 'idempotency-key', 'x-csrf-token', 'x-request-id'],
  exposedHeaders: ['etag', 'idempotency-replayed', 'location', 'retry-after', 'x-request-id'],
});
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
});
await app.register(rateLimit, {
  global: true,
  max: 180,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) => request.ip,
});

app.setGlobalPrefix('api/v1');
app.useGlobalFilters(new ApiExceptionFilter());
app.enableShutdownHooks();

const openApiConfig = new DocumentBuilder()
  .setTitle('SPLITO API')
  .setDescription('Versioned API for SPLITO expense sharing and its financial journal')
  .setVersion('1.0.0')
  .addCookieAuth('SPLITO_SESSION', { type: 'apiKey', in: 'cookie' }, 'session')
  .addApiKey({ type: 'apiKey', in: 'header', name: 'x-csrf-token' }, 'csrf')
  .build();
const openApiDocument = applyOpenApiContract(SwaggerModule.createDocument(app, openApiConfig));
SwaggerModule.setup('api/docs', app, openApiDocument, {
  jsonDocumentUrl: 'api/openapi.json',
});

await app.listen(config.API_PORT, config.API_HOST);
