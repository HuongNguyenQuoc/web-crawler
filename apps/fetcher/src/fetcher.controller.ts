import { Controller, Get } from '@nestjs/common';
import { FetcherService } from './fetcher.service';

@Controller()
export class FetcherController {
  constructor(private readonly fetcherService: FetcherService) {}

  @Get()
  getHello(): string {
    return this.fetcherService.getHello();
  }
}
