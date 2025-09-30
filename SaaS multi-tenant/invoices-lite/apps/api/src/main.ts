import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '0.0.0.0'; // <- IMPORTANTE
  await app.listen(port, host);
  console.log(`API listening on http://${host}:${port}`);
}
bootstrap();
