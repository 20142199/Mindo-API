import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const swagger = new DocumentBuilder()
    .setTitle('Mindo Phase 1 API')
    .setDescription('Auth, KYC, VND deposits, NFT purchase, transaction history and news')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

void bootstrap();
