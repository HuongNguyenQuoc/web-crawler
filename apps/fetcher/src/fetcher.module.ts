import { Module } from '@nestjs/common';
import { FetcherController } from './fetcher.controller';
import { FetcherService } from './fetcher.service';

@Module({
  imports: [],
  controllers: [FetcherController],
  providers: [FetcherService],
})
export class FetcherModule {}
