import { Injectable } from '@nestjs/common';

@Injectable()
export class FetcherService {
  getHello(): string {
    return 'Hello World!';
  }
}
