import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length) {
    return origins;
  }

  return ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];
}

async function bootstrap() {
  const allowedOrigins = parseAllowedOrigins();
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = Number(process.env.PORT || 3000);
  console.log(`[bootstrap] ALLOWED_ORIGINS=${allowedOrigins.join(', ')}`);
  await app.listen(port);
  console.log(`rps-ai-server listening on ${port}`);
}

void bootstrap();
