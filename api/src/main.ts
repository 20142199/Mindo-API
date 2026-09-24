import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { flattenValidationMessages } from './common/validation-messages';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  /*
    `exceptionFactory` replaces class-validator's default messages, which are
    English ("password must be longer than or equal to 8 characters") and would
    reach Vietnamese users verbatim. The first line becomes `message`, with a
    `VALIDATION_FAILED` code and the full list under `errors` for callers that
    need the detail.

    Messages declared on the DTOs themselves (`@Equals`, `@Matches`, ...) are
    already Vietnamese and are left alone; only the built-in rules are
    translated.
  */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const messages = flattenValidationMessages(errors);
        return new BadRequestException({
          message: messages[0] ?? 'Dữ liệu gửi lên không hợp lệ',
          code: 'VALIDATION_FAILED',
          errors: messages,
        });
      },
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const swagger = new DocumentBuilder()
    .setTitle('Mindo Phase 1 API')
    .setDescription('Auth, KYC, VND deposits, NFT purchase, transaction history, personalized news and expert profiles')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

void bootstrap();
