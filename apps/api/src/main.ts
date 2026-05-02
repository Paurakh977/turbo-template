import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { getApiEnv } from './env';

async function bootstrap() {
  const { host, port } = getApiEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.set('trust proxy', true);

  await app.listen(port, host);
}

void bootstrap();
