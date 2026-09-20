import { Test, TestingModule } from '@nestjs/testing';
import { FetcherController } from './fetcher.controller';
import { FetcherService } from './fetcher.service';

describe('FetcherController', () => {
  let fetcherController: FetcherController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [FetcherController],
      providers: [FetcherService],
    }).compile();

    fetcherController = app.get<FetcherController>(FetcherController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(fetcherController.getHello()).toBe('Hello World!');
    });
  });
});
