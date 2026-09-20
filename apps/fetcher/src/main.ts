import { NestFactory } from '@nestjs/core';
import { FetcherModule } from './fetcher.module';

async function bootstrap() {
  const app = await NestFactory.create(FetcherModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
