import { NestFactory } from '@nestjs/core';
import { ParserModule } from './parser.module';

async function bootstrap() {
  const app = await NestFactory.create(ParserModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
