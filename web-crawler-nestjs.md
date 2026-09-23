# Web Crawler — Real Project (NestJS 12 + TypeScript + Node 22)

Same system design as the Spring Boot version, rewritten in NestJS.

The architecture does not change at all — two workers, two SQS queues, S3 for blobs, Postgres for metadata, Redis for politeness and dedup. Only the language and the libraries change.

## Java → NestJS mapping

| Spring Boot | NestJS |
|---|---|
| Maven multi-module | Nest monorepo (`apps/` + `libs/`) |
| Spring Data JPA + Hibernate | TypeORM |
| Liquibase | TypeORM migrations |
| `@SqsListener` (Spring Cloud AWS) | `sqs-consumer` + AWS SDK v3 |
| Apache HttpClient 5 | `undici` (Node's built-in HTTP engine) |
| jsoup | `cheerio` |
| crawler-commons | `robots-parser` |
| Caffeine cache | `lru-cache` |
| Lettuce / RedisTemplate | `ioredis` |
| `@ConfigurationProperties` | `@nestjs/config` + `registerAs` |
| Virtual threads | The event loop (async/await) |
| `@Transactional` | `dataSource.transaction()` |

---

## 1. Tech stack

| Thing | Choice | Note |
|---|---|---|
| Runtime | Node.js 22 LTS | NestJS 12 recommends the latest active LTS |
| Framework | NestJS 12 | Choose **CommonJS** when the CLI asks — TypeORM decorators are simpler that way |
| Language | TypeScript 5.x | `experimentalDecorators` on |
| Queue | AWS SQS via `@aws-sdk/client-sqs` + `sqs-consumer` | Manual delete gives us the same "ack" behaviour |
| Blob storage | `@aws-sdk/client-s3` | |
| Database | PostgreSQL 17 + TypeORM | `orIgnore()` gives `ON CONFLICT DO NOTHING` |
| Redis | `ioredis` | `defineCommand` loads our Lua scripts once |
| HTTP | `undici` Agent + global `fetch` | The Agent lets us inject a custom DNS lookup |
| HTML | `cheerio` | jQuery-style API over the parsed DOM |
| robots.txt | `robots-parser` | |

---

## 2. Project structure

```
web-crawler-nest/
├── package.json
├── tsconfig.json
├── nest-cli.json
├── docker-compose.yml
├── localstack-init.sh
│
├── libs/common/src/
│   ├── common.module.ts
│   ├── config/crawler.config.ts
│   ├── entities/url.entity.ts
│   ├── entities/domain.entity.ts
│   ├── entities/url-status.enum.ts
│   ├── messages/messages.ts
│   ├── redis/redis.module.ts
│   ├── redis/redis.service.ts
│   ├── storage/s3.service.ts
│   ├── queue/sqs.service.ts
│   ├── queue/sqs-consumer.factory.ts
│   ├── url/url.service.ts
│   ├── util/url-normalizer.ts
│   └── database/migrations/1700000000000-InitSchema.ts
│
├── apps/fetcher/src/
│   ├── main.ts
│   ├── fetcher.module.ts
│   ├── dns/dns-cache.service.ts
│   ├── http/http-client.service.ts
│   ├── http/fetch-result.ts
│   ├── politeness/robots.service.ts
│   ├── politeness/rate-limiter.service.ts
│   ├── politeness/domain-lock.service.ts
│   ├── frontier/frontier.consumer.ts
│   └── api/seed.controller.ts
│
└── apps/parser/src/
    ├── main.ts
    ├── parser.module.ts
    ├── dedup.service.ts
    ├── html-parser.service.ts
    └── parsing.consumer.ts
```

Create it with:

```bash
npm i -g @nestjs/cli
nest new web-crawler-nest        # choose CommonJS, npm
cd web-crawler-nest

# turn it into a monorepo with two apps and one shared library
nest generate app fetcher
nest generate app parser
nest generate library common
```

The CLI will ask for a library prefix — accept the default `@app`, so imports look like `@app/common`.

---

## 3. `package.json`

```json
{
  "name": "web-crawler-nest",
  "version": "1.0.0",
  "scripts": {
    "build": "nest build fetcher && nest build parser",
    "start:fetcher": "nest start fetcher --watch",
    "start:parser": "nest start parser --watch",
    "prod:fetcher": "node dist/apps/fetcher/main",
    "prod:parser": "node dist/apps/parser/main",
    "migration:run": "typeorm-ts-node-commonjs migration:run -d libs/common/src/database/data-source.ts",
    "migration:revert": "typeorm-ts-node-commonjs migration:revert -d libs/common/src/database/data-source.ts",
    "test": "jest"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/client-sqs": "^3.700.0",
    "@nestjs/common": "^12.0.1",
    "@nestjs/config": "^12.0.0",
    "@nestjs/core": "^12.0.1",
    "@nestjs/platform-express": "^12.0.1",
    "@nestjs/typeorm": "^12.0.0",
    "cheerio": "^1.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.4.1",
    "lru-cache": "^11.0.2",
    "pg": "^8.13.1",
    "reflect-metadata": "^0.2.2",
    "robots-parser": "^3.0.1",
    "rxjs": "^7.8.1",
    "sqs-consumer": "^11.4.0",
    "typeorm": "^0.3.20",
    "undici": "^7.2.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^12.0.0",
    "@nestjs/testing": "^12.0.1",
    "@types/node": "^22.10.0",
    "jest": "^29.7.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.2"
  }
}
```

> If `@nestjs/config` or `@nestjs/typeorm` have not released a v12 line yet, install the latest v11 instead — they stay compatible.

`tsconfig.json` — the important flags:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "baseUrl": "./",
    "paths": {
      "@app/common": ["libs/common/src"],
      "@app/common/*": ["libs/common/src/*"]
    }
  }
}
```

---

## 4. Infrastructure

`docker-compose.yml` and `localstack-init.sh` are **exactly the same** as in the Spring Boot version. Copy them over without changes — Postgres, Redis Stack and LocalStack do not care which language talks to them.

---

## 5. Shared library (`libs/common`)

### `config/crawler.config.ts`

```ts
import { registerAs } from '@nestjs/config';

export const crawlerConfig = registerAs('crawler', () => ({
  // stop following links after this many hops from a seed URL
  maxDepth: Number(process.env.CRAWLER_MAX_DEPTH ?? 15),

  // never hit one domain faster than this, even if robots.txt allows it
  minCrawlDelayMs: Number(process.env.CRAWLER_MIN_DELAY_MS ?? 1000),
  defaultCrawlDelayMs: Number(process.env.CRAWLER_DEFAULT_DELAY_MS ?? 1000),

  maxPageBytes: Number(process.env.CRAWLER_MAX_PAGE_BYTES ?? 10 * 1024 * 1024),
  maxLinksPerPage: Number(process.env.CRAWLER_MAX_LINKS ?? 500),

  userAgent: process.env.CRAWLER_USER_AGENT ?? 'HuongCrawlerBot/1.0 (+https://example.com/bot)',
  robotsAgentName: process.env.CRAWLER_ROBOTS_AGENT ?? 'HuongCrawlerBot',

  requestTimeoutMs: Number(process.env.CRAWLER_TIMEOUT_MS ?? 15000),
  dnsCacheTtlSec: Number(process.env.CRAWLER_DNS_TTL_SEC ?? 6 * 3600),
  robotsTtlSec: Number(process.env.CRAWLER_ROBOTS_TTL_SEC ?? 24 * 3600),

  htmlBucket: process.env.CRAWLER_HTML_BUCKET ?? 'crawler-html',
  textBucket: process.env.CRAWLER_TEXT_BUCKET ?? 'crawler-text',
  frontierQueue: process.env.CRAWLER_FRONTIER_QUEUE ?? 'frontier-queue',
  parsingQueue: process.env.CRAWLER_PARSING_QUEUE ?? 'parsing-queue',

  fetchConcurrency: Number(process.env.CRAWLER_FETCH_CONCURRENCY ?? 5),
  parseConcurrency: Number(process.env.CRAWLER_PARSE_CONCURRENCY ?? 2),

  bloomCapacity: Number(process.env.CRAWLER_BLOOM_CAPACITY ?? 10_000_000),
  bloomErrorRate: Number(process.env.CRAWLER_BLOOM_ERROR_RATE ?? 0.001),
}));

export const awsConfig = registerAs('aws', () => ({
  region: process.env.AWS_REGION ?? 'ap-southeast-1',
  // LocalStack only. Leave it undefined to talk to real AWS.
  endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  forcePathStyle: true,
}));
```

### `entities/url-status.enum.ts`

```ts
export enum UrlStatus {
  PENDING = 'PENDING',
  FETCHED = 'FETCHED',
  PARSED = 'PARSED',
  SKIPPED_ROBOTS = 'SKIPPED_ROBOTS',
  SKIPPED_DUPLICATE = 'SKIPPED_DUPLICATE',
  SKIPPED_TOO_LARGE = 'SKIPPED_TOO_LARGE',
  SKIPPED_TOO_DEEP = 'SKIPPED_TOO_DEEP',
  FAILED = 'FAILED',
}
```

### `entities/url.entity.ts`

```ts
import {
  Column, CreateDateColumn, Entity, Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { UrlStatus } from './url-status.enum';

@Entity('url')
export class UrlEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;                       // bigint comes back as a string in node-postgres

  @Column({ type: 'text' })
  url: string;

  @Index('ux_url_hash', { unique: true })
  @Column({ name: 'url_hash', type: 'char', length: 64 })
  urlHash: string;

  @Index('ix_url_domain')
  @Column({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ type: 'int', default: 0 })
  depth: number;

  @Index('ix_url_status')
  @Column({ type: 'varchar', length: 32, default: UrlStatus.PENDING })
  status: UrlStatus;

  @Column({ name: 's3_html_key', type: 'varchar', length: 512, nullable: true })
  s3HtmlKey: string | null;

  @Column({ name: 's3_text_key', type: 'varchar', length: 512, nullable: true })
  s3TextKey: string | null;

  @Index('ix_url_content_hash')
  @Column({ name: 'content_hash', type: 'char', length: 64, nullable: true })
  contentHash: string | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  errorMessage: string | null;

  @Column({ name: 'last_crawl_time', type: 'timestamptz', nullable: true })
  lastCrawlTime: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

### `entities/domain.entity.ts`

```ts
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('domain')
export class DomainEntity {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ name: 'robots_txt', type: 'text', nullable: true })
  robotsTxt: string | null;

  @Column({ name: 'crawl_delay_ms', type: 'bigint', default: 1000 })
  crawlDelayMs: string;

  @Column({ name: 'robots_fetched_at', type: 'timestamptz', nullable: true })
  robotsFetchedAt: Date | null;

  @Column({ name: 'last_crawl_time', type: 'timestamptz', nullable: true })
  lastCrawlTime: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

### `database/data-source.ts` and the migration

```ts
// libs/common/src/database/data-source.ts
import { DataSource } from 'typeorm';
import { UrlEntity } from '../entities/url.entity';
import { DomainEntity } from '../entities/domain.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'crawler',
  password: process.env.DB_PASSWORD ?? 'crawler',
  database: process.env.DB_NAME ?? 'crawler',
  entities: [UrlEntity, DomainEntity],
  migrations: ['libs/common/src/database/migrations/*.ts'],
  synchronize: false,      // migrations own the schema, never auto-sync
});
```

```ts
// libs/common/src/database/migrations/1700000000000-InitSchema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE url (
        id              BIGSERIAL PRIMARY KEY,
        url             TEXT         NOT NULL,
        url_hash        CHAR(64)     NOT NULL,
        domain          VARCHAR(255) NOT NULL,
        depth           INT          NOT NULL DEFAULT 0,
        status          VARCHAR(32)  NOT NULL DEFAULT 'PENDING',
        s3_html_key     VARCHAR(512),
        s3_text_key     VARCHAR(512),
        content_hash    CHAR(64),
        retry_count     INT          NOT NULL DEFAULT 0,
        error_message   VARCHAR(1000),
        last_crawl_time TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`);

    await q.query(`CREATE UNIQUE INDEX ux_url_hash ON url (url_hash)`);
    await q.query(`CREATE INDEX ix_url_content_hash ON url (content_hash)`);
    await q.query(`CREATE INDEX ix_url_status ON url (status)`);
    await q.query(`CREATE INDEX ix_url_domain ON url (domain)`);

    await q.query(`
      CREATE TABLE domain (
        domain            VARCHAR(255) PRIMARY KEY,
        robots_txt        TEXT,
        crawl_delay_ms    BIGINT      NOT NULL DEFAULT 1000,
        robots_fetched_at TIMESTAMPTZ,
        last_crawl_time   TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE domain`);
    await q.query(`DROP TABLE url`);
  }
}
```

### `util/url-normalizer.ts`

```ts
import { createHash } from 'node:crypto';

const TRACKING_PREFIXES = ['utm_', 'fbclid', 'gclid', 'msclkid', 'ref_src'];

/**
 * Produce one canonical form of a URL, so that two links pointing at the
 * same page produce the same hash. Returns null for anything that is not
 * a normal http(s) page (mailto:, javascript:, ftp:, ...).
 */
export function normalizeUrl(raw: string): string | null {
  if (!raw?.trim()) return null;

  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;

  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);

  const isDefaultPort =
    !u.port ||
    (u.protocol === 'http:' && u.port === '80') ||
    (u.protocol === 'https:' && u.port === '443');

  let path = u.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  // drop tracking params, then sort the rest so order does not matter
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PREFIXES.some((t) => k.toLowerCase().startsWith(t)))
    .sort(([a], [b]) => a.localeCompare(b));

  const query = new URLSearchParams(params).toString();

  // URL ban đầu: https://EXAMPLE.com:443/products?id=123&utm_source=google#reviews
  let out = `${u.protocol}//${host}`;
  if (!isDefaultPort) out += `:${u.port}`;
  out += path; // path: for example like: /products
  if (query) out += `?${query}`; // query: id=123
  return out;   // the #fragment is dropped automatically
}

export function domainOf(normalized: string): string {
  return new URL(normalized).hostname;
}

export function sha256(value: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
```

### `messages/messages.ts`

```ts
export interface FetchMessage {
  urlId: string;
  url: string;
  depth: number;
}

export interface ParseMessage {
  urlId: string;
  url: string;
  s3HtmlKey: string;
  depth: number;
}
```

### `redis/redis.service.ts` (+ the Lua scripts)

`ioredis.defineCommand` registers a Lua script once and gives you a normal method to call. It handles `EVALSHA` caching for you.

```ts
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { crawlerConfig } from '../config/crawler.config';

const RATE_LIMIT_LUA = `
  local key    = KEYS[1]
  local now    = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit  = tonumber(ARGV[3])

  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  local used = redis.call('ZCARD', key)
  if used < limit then
    redis.call('ZADD', key, now, ARGV[4])
    redis.call('PEXPIRE', key, window)
    return 1
  end
  return 0
`;

// BF.ADD does check-and-insert atomically:
//   1 = new content, 0 = probably seen before
const BLOOM_ADD_LUA = `return redis.call('BF.ADD', KEYS[1], ARGV[1])`;

const BLOOM_RESERVE_LUA = `
  local res = redis.pcall('BF.RESERVE', KEYS[1], ARGV[1], ARGV[2])
  if type(res) == 'table' and res.err then return 0 end
  return 1
`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>) {
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: 3,
    });

    this.client.defineCommand('rateLimit', { numberOfKeys: 1, lua: RATE_LIMIT_LUA });
    this.client.defineCommand('bloomAdd', { numberOfKeys: 1, lua: BLOOM_ADD_LUA });
    this.client.defineCommand('bloomReserve', { numberOfKeys: 1, lua: BLOOM_RESERVE_LUA });
  }

  /** Global rate limit shared by every crawler process. */
  async tryAcquire(domain: string, limit = 1, windowMs = 1000): Promise<boolean> {
    const res = await (this.client as any).rateLimit(
      `rate:${domain}`, Date.now(), windowMs, limit, randomUUID(),
    );
    return res === 1;
  }

  /** SET NX PX — only one process wins the domain for the length of the crawl delay. */
  async tryLockDomain(domain: string, crawlDelayMs: number): Promise<boolean> {
    const res = await this.client.set(`lock:domain:${domain}`, '1', 'PX', crawlDelayMs, 'NX');
    return res === 'OK';
  }

  async reserveBloom(filter: string): Promise<void> {
    await (this.client as any).bloomReserve(
      filter, this.cfg.bloomErrorRate, this.cfg.bloomCapacity,
    );
  }

  /** true = new content, false = duplicate. */
  async bloomMarkIfNew(filter: string, hash: string): Promise<boolean> {
    const res = await (this.client as any).bloomAdd(filter, hash);
    return res === 1;
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
```

### `storage/s3.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { gunzipSync, gzipSync } from 'node:zlib';
import { awsConfig, crawlerConfig } from '../config/crawler.config';

@Injectable()
export class S3Service {
  private readonly s3: S3Client;

  constructor(
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
    @Inject(awsConfig.KEY) aws: ConfigType<typeof awsConfig>,
  ) {
    this.s3 = new S3Client({
      region: aws.region,
      endpoint: aws.endpoint,          // remove this line for real AWS
      forcePathStyle: aws.forcePathStyle,
      credentials: { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey },
    });
  }

  /** Store raw HTML gzipped. The key is sharded so one prefix does not get huge. */
  async putHtml(urlId: string, html: Buffer): Promise<string> {
    const key = `html/${Number(urlId) % 100}/${urlId}.html.gz`;
    await this.put(this.cfg.htmlBucket, key, gzipSync(html), 'text/html');
    return key;
  }

  async putText(urlId: string, text: string): Promise<string> {
    const key = `text/${Number(urlId) % 100}/${urlId}.txt.gz`;
    await this.put(this.cfg.textBucket, key, gzipSync(Buffer.from(text, 'utf8')), 'text/plain');
    return key;
  }

  async getHtml(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.cfg.htmlBucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return gunzipSync(Buffer.from(bytes));
  }

  private async put(bucket: string, key: string, body: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body,
      ContentType: contentType, ContentEncoding: 'gzip',
    }));
  }
}
```

### `queue/sqs.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  ChangeMessageVisibilityCommand, DeleteMessageCommand,
  GetQueueUrlCommand, SendMessageCommand, SQSClient,
} from '@aws-sdk/client-sqs';
import { awsConfig } from '../config/crawler.config';

@Injectable()
export class SqsService {
  readonly client: SQSClient;
  private readonly urlCache = new Map<string, string>();

  constructor(@Inject(awsConfig.KEY) aws: ConfigType<typeof awsConfig>) {
    this.client = new SQSClient({
      region: aws.region,
      endpoint: aws.endpoint,          // remove for real AWS
      credentials: { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey },
    });
  }

  /** Queue names are stable, so resolve the URL once and cache it. */
  async queueUrl(queueName: string): Promise<string> {
    const cached = this.urlCache.get(queueName);
    if (cached) return cached;
    const res = await this.client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    this.urlCache.set(queueName, res.QueueUrl!);
    return res.QueueUrl!;
  }

  async send(queueName: string, payload: unknown): Promise<void> {
    const QueueUrl = await this.queueUrl(queueName);
    await this.client.send(new SendMessageCommand({
      QueueUrl, MessageBody: JSON.stringify(payload),
    }));
  }

  /** This is our "ack" — the message is gone for good. */
  async ack(queueName: string, receiptHandle: string): Promise<void> {
    const QueueUrl = await this.queueUrl(queueName);
    await this.client.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: receiptHandle }));
  }

  /** Push the message back into the future without acking it. */
  async defer(queueName: string, receiptHandle: string, seconds: number): Promise<void> {
    const QueueUrl = await this.queueUrl(queueName);
    await this.client.send(new ChangeMessageVisibilityCommand({
      QueueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: seconds,
    }));
  }
}
```

### `queue/sqs-consumer.factory.ts`

`sqs-consumer` polls one message batch at a time. To get more parallelism we simply start several consumers.

```ts
import { Logger } from '@nestjs/common';
import { Consumer } from 'sqs-consumer';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { Message } from '@aws-sdk/client-sqs';

export interface ConsumerOptions {
  queueUrl: string;
  sqs: SQSClient;
  concurrency: number;
  batchSize?: number;
  handler: (message: Message) => Promise<void>;
  name: string;
}

/**
 * shouldDeleteMessages: false is the key line. It means sqs-consumer will
 * NOT delete a message automatically after the handler resolves. We delete it
 * ourselves, exactly like ack.acknowledge() in Spring. If the process crashes,
 * nothing is deleted and SQS re-delivers after the visibility timeout.
 */
export function startConsumers(opts: ConsumerOptions): Consumer[] {
  const logger = new Logger(opts.name);
  const consumers: Consumer[] = [];

  for (let i = 0; i < opts.concurrency; i++) {
    const consumer = Consumer.create({
      queueUrl: opts.queueUrl,
      sqs: opts.sqs,
      batchSize: opts.batchSize ?? 10,
      shouldDeleteMessages: false,
      waitTimeSeconds: 20,            // long polling: cheaper and faster
      handleMessage: opts.handler,
    });

    consumer.on('error', (err) => logger.error(`consumer error: ${err.message}`));
    consumer.on('processing_error', (err) => logger.warn(`handler error: ${err.message}`));

    consumer.start();
    consumers.push(consumer);
  }

  logger.log(`started ${opts.concurrency} consumers on ${opts.queueUrl}`);
  return consumers;
}
```

### `url/url.service.ts` — the only place that writes to the frontier

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { crawlerConfig } from '../config/crawler.config';
import { UrlEntity } from '../entities/url.entity';
import { UrlStatus } from '../entities/url-status.enum';
import { FetchMessage } from '../messages/messages';
import { SqsService } from '../queue/sqs.service';
import { domainOf, normalizeUrl, sha256 } from '../util/url-normalizer';

@Injectable()
export class UrlService {
  private readonly logger = new Logger(UrlService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sqs: SqsService,
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
  ) {}

  /** Add a URL to the frontier only if we have never seen it. Returns true if added. */
  async enqueueIfNew(rawUrl: string, depth: number): Promise<boolean> {
    if (depth > this.cfg.maxDepth) return false;      // crawler trap guard

    const url = normalizeUrl(rawUrl);
    if (!url) return false;

    const urlHash = sha256(url);
    const domain = domainOf(url);

    // ON CONFLICT DO NOTHING ... RETURNING id
    // If the row already existed we get an empty result, so we know not to re-queue.
    const result = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(UrlEntity)
      .values({ url, urlHash, domain, depth, status: UrlStatus.PENDING })
      .orIgnore()
      .returning('id')
      .execute();

    const id: string | undefined = result.raw?.[0]?.id;
    if (!id) return false;

    const message: FetchMessage = { urlId: String(id), url, depth };
    await this.sqs.send(this.cfg.frontierQueue, message);

    this.logger.debug(`frontier += ${url} (depth=${depth})`);
    return true;
  }

  async markStatus(urlId: string, status: UrlStatus): Promise<void> {
    await this.dataSource.getRepository(UrlEntity)
      .update({ id: urlId }, { status, updatedAt: new Date() });
  }

  async markFailed(urlId: string, message: string): Promise<void> {
    await this.dataSource.getRepository(UrlEntity)
      .createQueryBuilder()
      .update(UrlEntity)
      .set({
        status: UrlStatus.FAILED,
        errorMessage: message.slice(0, 990),
        retryCount: () => 'retry_count + 1',
        updatedAt: new Date(),
      })
      .where('id = :id', { id: urlId })
      .execute();
  }
}
```

### `common.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { awsConfig, crawlerConfig } from './config/crawler.config';
import { UrlEntity } from './entities/url.entity';
import { DomainEntity } from './entities/domain.entity';
import { RedisService } from './redis/redis.service';
import { S3Service } from './storage/s3.service';
import { SqsService } from './queue/sqs.service';
import { UrlService } from './url/url.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [crawlerConfig, awsConfig] }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? 'crawler',
      password: process.env.DB_PASSWORD ?? 'crawler',
      database: process.env.DB_NAME ?? 'crawler',
      entities: [UrlEntity, DomainEntity],
      synchronize: false,
      poolSize: 30,
    }),
    TypeOrmModule.forFeature([UrlEntity, DomainEntity]),
  ],
  providers: [RedisService, S3Service, SqsService, UrlService],
  exports: [RedisService, S3Service, SqsService, UrlService, TypeOrmModule],
})
export class CommonModule {}
```

---

## 6. App `fetcher` (the Crawler)

### `dns/dns-cache.service.ts`

DNS is a genuine bottleneck at thousands of requests per second across millions of domains. We cache the answer in Redis so every crawler process shares one lookup.

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LookupFunction } from 'node:net';
import { promises as dns } from 'node:dns';
import { crawlerConfig, RedisService } from '@app/common';

@Injectable()
export class DnsCacheService {
  private readonly logger = new Logger(DnsCacheService.name);

  constructor(
    private readonly redis: RedisService,
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
  ) {}

  /**
   * Returns a function with the same shape Node's net.connect expects,
   * so undici can use it instead of the default resolver.
   */
  get lookup(): LookupFunction {
    return (hostname, options, callback) => {
      this.resolve(hostname)
        .then((address) => callback(null, address, 4))
        .catch((err) => callback(err, '', 4));
    };
  }

  private async resolve(hostname: string): Promise<string> {
    const key = `dns:${hostname}`;
    const cached = await this.redis.client.get(key);

    if (cached === '!') throw new Error(`ENOTFOUND ${hostname} (cached failure)`);
    if (cached) return cached;

    try {
      const addresses = await dns.resolve4(hostname);
      if (!addresses.length) throw new Error(`ENOTFOUND ${hostname}`);
      await this.redis.client.set(key, addresses[0], 'EX', this.cfg.dnsCacheTtlSec);
      return addresses[0];
    } catch (err) {
      // negative caching: do not ask DNS again about a dead host for 10 minutes
      await this.redis.client.set(key, '!', 'EX', 600);
      this.logger.debug(`dns failed for ${hostname}`);
      throw err;
    }
  }
}
```

### `http/fetch-result.ts`

```ts
export type FetchResult =
  | { kind: 'ok'; body: Buffer; contentType: string; statusCode: number }
  | { kind: 'skip'; reason: string }        // do not retry: 404, not HTML, too big
  | { kind: 'retryable'; reason: string };  // temporary: 5xx, timeout
```

### `http/http-client.service.ts`

```ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Agent } from 'undici';
import { crawlerConfig } from '@app/common';
import { DnsCacheService } from '../dns/dns-cache.service';
import { FetchResult } from './fetch-result';

@Injectable()
export class HttpClientService implements OnModuleInit {
  private readonly logger = new Logger(HttpClientService.name);
  private agent!: Agent;

  constructor(
    private readonly dnsCache: DnsCacheService,
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
  ) {}

  onModuleInit() {
    this.agent = new Agent({
      connections: 2,                       // per origin -> politeness at the socket level
      connect: {
        lookup: this.dnsCache.lookup,       // our Redis DNS cache
        timeout: 5000,
      },
      headersTimeout: this.cfg.requestTimeoutMs,
      bodyTimeout: this.cfg.requestTimeoutMs,
    });
  }

  async fetchPage(url: string): Promise<FetchResult> {
    // 1. HEAD first: cheap, and it stops us downloading a 500MB video
    const head = await this.head(url);
    if (head.kind !== 'ok') return head;

    // 2. the real GET
    try {
      const res = await fetch(url, {
        method: 'GET',
        // @ts-expect-error dispatcher is a Node/undici extension of fetch
        dispatcher: this.agent,
        redirect: 'follow',
        headers: {
          'user-agent': this.cfg.userAgent,
          accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });

      if (res.status >= 500 || res.status === 429) {
        return { kind: 'retryable', reason: `http ${res.status}` };
      }
      if (res.status >= 400) {
        return { kind: 'skip', reason: `http ${res.status}` };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !contentType.toLowerCase().includes('html')) {
        return { kind: 'skip', reason: `not html: ${contentType}` };
      }

      const body = await this.readLimited(res);
      if (!body) return { kind: 'skip', reason: 'body over limit' };

      return { kind: 'ok', body, contentType, statusCode: res.status };
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        return { kind: 'retryable', reason: 'timeout' };
      }
      this.logger.debug(`GET failed ${url}: ${err?.message}`);
      return { kind: 'retryable', reason: err?.message ?? 'network error' };
    }
  }

  private async head(url: string): Promise<FetchResult> {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        // @ts-expect-error dispatcher is a Node/undici extension of fetch
        dispatcher: this.agent,
        redirect: 'follow',
        headers: { 'user-agent': this.cfg.userAgent },
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });

      // some servers do not implement HEAD - just continue to GET
      if (res.status === 405 || res.status === 501) {
        return { kind: 'ok', body: Buffer.alloc(0), contentType: '', statusCode: res.status };
      }
      if (res.status >= 500) return { kind: 'retryable', reason: `head http ${res.status}` };
      if (res.status >= 400) return { kind: 'skip', reason: `head http ${res.status}` };

      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > this.cfg.maxPageBytes) {
        return { kind: 'skip', reason: `too large: ${length} bytes` };
      }
      const type = res.headers.get('content-type') ?? '';
      if (type && !type.toLowerCase().includes('html')) {
        return { kind: 'skip', reason: `not html: ${type}` };
      }
      return { kind: 'ok', body: Buffer.alloc(0), contentType: type, statusCode: res.status };
    } catch (err: any) {
      return { kind: 'retryable', reason: `head failed: ${err?.message}` };
    }
  }

  /** Read the stream but stop early if it grows past the limit — servers lie about Content-Length. */
  private async readLimited(res: Response): Promise<Buffer | null> {
    if (!res.body) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > this.cfg.maxPageBytes) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
```

### `politeness/robots.service.ts`

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LRUCache } from 'lru-cache';
import robotsParser, { Robot } from 'robots-parser';
import { crawlerConfig, DomainEntity } from '@app/common';

@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);

  /** Parsing robots.txt for every URL would be wasteful, so keep the parsed object in memory. */
  private readonly cache = new LRUCache<string, Robot>({
    max: 100_000,
    ttl: 6 * 60 * 60 * 1000,
  });

  constructor(
    @InjectRepository(DomainEntity) private readonly domainRepo: Repository<DomainEntity>,
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
  ) {}

  async isAllowed(url: string): Promise<boolean> {
    const robots = await this.rulesFor(url);
    // robots-parser returns undefined when it has no opinion -> treat as allowed
    return robots.isAllowed(url, this.cfg.robotsAgentName) !== false;
  }

  async crawlDelayMs(url: string): Promise<number> {
    const robots = await this.rulesFor(url);
    const seconds = robots.getCrawlDelay(this.cfg.robotsAgentName);
    const fromRobots = seconds ? seconds * 1000 : this.cfg.defaultCrawlDelayMs;
    return Math.max(this.cfg.minCrawlDelayMs, fromRobots);
  }

  private async rulesFor(url: string): Promise<Robot> {
    const { hostname, origin } = new URL(url);
    const cached = this.cache.get(hostname);
    if (cached) return cached;

    const robotsUrl = `${origin}/robots.txt`;
    let body: string | null = null;

    // 1. already saved by another process?
    const existing = await this.domainRepo.findOne({ where: { domain: hostname } });
    const fresh =
      existing?.robotsFetchedAt &&
      Date.now() - existing.robotsFetchedAt.getTime() < this.cfg.robotsTtlSec * 1000;

    if (fresh && existing?.robotsTxt) {
      body = existing.robotsTxt;
    } else {
      // 2. download it
      try {
        const res = await fetch(robotsUrl, {
          headers: { 'user-agent': this.cfg.userAgent },
          signal: AbortSignal.timeout(10_000),
        });
        body = res.ok ? await res.text() : null;
      } catch (err: any) {
        this.logger.debug(`robots.txt fetch failed for ${hostname}: ${err?.message}`);
      }

      // 3. save it so other machines do not download it again
      const parsed = robotsParser(robotsUrl, body ?? '');
      const delaySec = parsed.getCrawlDelay(this.cfg.robotsAgentName);
      await this.domainRepo.save({
        domain: hostname,
        robotsTxt: body,
        robotsFetchedAt: new Date(),
        crawlDelayMs: String(
          Math.max(this.cfg.minCrawlDelayMs, delaySec ? delaySec * 1000 : this.cfg.defaultCrawlDelayMs),
        ),
      });
    }

    // No robots.txt means everything is allowed — that is the standard behaviour.
    const robots = robotsParser(robotsUrl, body ?? '');
    this.cache.set(hostname, robots);
    return robots;
  }
}
```

### `politeness/rate-limiter.service.ts` and `domain-lock.service.ts`

These are thin wrappers over `RedisService`, kept separate so the intent is obvious:

```ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '@app/common';

/** Global limit: 1 request per domain per second, shared by every process. */
@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  tryAcquire(domain: string): Promise<boolean> {
    return this.redis.tryAcquire(domain, 1, 1000);
  }
}
```

```ts
import { Injectable } from '@nestjs/common';
import { RedisService } from '@app/common';

/**
 * Two workers can pull two URLs of the same domain at the same moment.
 * SET NX PX is atomic, so only one wins; the key expires after the crawl
 * delay, which automatically spaces out the next request.
 */
@Injectable()
export class DomainLockService {
  constructor(private readonly redis: RedisService) {}

  tryLock(domain: string, crawlDelayMs: number): Promise<boolean> {
    return this.redis.tryLockDomain(domain, crawlDelayMs);
  }
}
```

### `frontier/frontier.consumer.ts` — the heart of the crawler

```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Message } from '@aws-sdk/client-sqs';
import { Consumer } from 'sqs-consumer';
import {
  crawlerConfig, DomainEntity, FetchMessage, ParseMessage,
  S3Service, SqsService, startConsumers, UrlEntity, UrlService, UrlStatus,
} from '@app/common';
import { HttpClientService } from '../http/http-client.service';
import { RobotsService } from '../politeness/robots.service';
import { RateLimiterService } from '../politeness/rate-limiter.service';
import { DomainLockService } from '../politeness/domain-lock.service';

@Injectable()
export class FrontierConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FrontierConsumer.name);
  private consumers: Consumer[] = [];

  constructor(
    private readonly http: HttpClientService,
    private readonly robots: RobotsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly domainLock: DomainLockService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    private readonly urlService: UrlService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
  ) {}

  async onModuleInit() {
    const queueUrl = await this.sqs.queueUrl(this.cfg.frontierQueue);
    this.consumers = startConsumers({
      name: 'FrontierConsumer',
      queueUrl,
      sqs: this.sqs.client,
      concurrency: this.cfg.fetchConcurrency,
      handler: (message) => this.handle(message),
    });
  }

  onModuleDestroy() {
    this.consumers.forEach((c) => c.stop());
  }

  private async handle(message: Message): Promise<void> {
    const body: FetchMessage = JSON.parse(message.Body!);
    const receipt = message.ReceiptHandle!;
    const queue = this.cfg.frontierQueue;
    const domain = new URL(body.url).hostname;

    // 1. crawler trap guard
    if (body.depth > this.cfg.maxDepth) {
      await this.urlService.markStatus(body.urlId, UrlStatus.SKIPPED_TOO_DEEP);
      return this.sqs.ack(queue, receipt);
    }

    // 2. robots.txt
    if (!(await this.robots.isAllowed(body.url))) {
      this.logger.debug(`robots.txt disallows ${body.url}`);
      await this.urlService.markStatus(body.urlId, UrlStatus.SKIPPED_ROBOTS);
      return this.sqs.ack(queue, receipt);
    }
    const crawlDelayMs = await this.robots.crawlDelayMs(body.url);

    // 3. politeness: one worker per domain at a time, plus 1 req/sec
    const gotLock = await this.domainLock.tryLock(domain, crawlDelayMs);
    const gotSlot = gotLock && (await this.rateLimiter.tryAcquire(domain));

    if (!gotSlot) {
      // Do NOT ack. Defer with jitter, otherwise every waiting worker
      // wakes up in the same millisecond and they all collide again.
      const jitter = 1 + Math.floor(Math.random() * 4);
      const deferSeconds = Math.max(1, Math.ceil(crawlDelayMs / 1000)) + jitter;
      return this.sqs.defer(queue, receipt, deferSeconds);
    }

    // 4. fetch
    const result = await this.http.fetchPage(body.url);

    switch (result.kind) {
      case 'ok':
        await this.storeAndForward(body, domain, result.body);
        return this.sqs.ack(queue, receipt);

      case 'skip':
        this.logger.debug(`skip ${body.url} -> ${result.reason}`);
        await this.urlService.markStatus(body.urlId, UrlStatus.SKIPPED_TOO_LARGE);
        return this.sqs.ack(queue, receipt);

      case 'retryable':
        // no ack -> SQS makes it visible again; after 5 tries it lands in the DLQ
        this.logger.debug(`retry later ${body.url} -> ${result.reason}`);
        await this.urlService.markFailed(body.urlId, result.reason);
        return this.sqs.defer(queue, receipt, 30 + Math.floor(Math.random() * 30));
    }
  }

  private async storeAndForward(body: FetchMessage, domain: string, html: Buffer) {
    // a) raw HTML goes to S3, never into the queue
    const key = await this.s3.putHtml(body.urlId, html);

    // b) update metadata in one transaction
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(UrlEntity).update(
        { id: body.urlId },
        { s3HtmlKey: key, status: UrlStatus.FETCHED, lastCrawlTime: new Date() },
      );
      await manager.getRepository(DomainEntity).update(
        { domain },
        { lastCrawlTime: new Date() },
      );
    });

    // c) hand over to the parsing pipeline
    const next: ParseMessage = {
      urlId: body.urlId, url: body.url, s3HtmlKey: key, depth: body.depth,
    };
    await this.sqs.send(this.cfg.parsingQueue, next);
  }
}
```

### `api/seed.controller.ts`

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UrlEntity, UrlService, UrlStatus } from '@app/common';

class SeedDto {
  urls: string[];
}

@Controller('api/v1')
export class SeedController {
  constructor(
    private readonly urlService: UrlService,
    @InjectRepository(UrlEntity) private readonly urlRepo: Repository<UrlEntity>,
  ) {}

  @Post('seeds')
  async seed(@Body() dto: SeedDto) {
    let added = 0;
    for (const url of dto.urls ?? []) {
      if (await this.urlService.enqueueIfNew(url, 0)) added++;
    }
    return { received: dto.urls?.length ?? 0, added };
  }

  @Get('stats')
  async stats() {
    const rows = await this.urlRepo
      .createQueryBuilder('u')
      .select('u.status', 'status')
      .addSelect('count(*)', 'count')
      .groupBy('u.status')
      .getRawMany<{ status: UrlStatus; count: string }>();

    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    out.TOTAL = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  }
}
```

### `fetcher.module.ts` and `main.ts`

```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '@app/common';
import { DnsCacheService } from './dns/dns-cache.service';
import { HttpClientService } from './http/http-client.service';
import { RobotsService } from './politeness/robots.service';
import { RateLimiterService } from './politeness/rate-limiter.service';
import { DomainLockService } from './politeness/domain-lock.service';
import { FrontierConsumer } from './frontier/frontier.consumer';
import { SeedController } from './api/seed.controller';

@Module({
  imports: [CommonModule],
  controllers: [SeedController],
  providers: [
    DnsCacheService, HttpClientService, RobotsService,
    RateLimiterService, DomainLockService, FrontierConsumer,
  ],
})
export class FetcherModule {}
```

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { FetcherModule } from './fetcher.module';

async function bootstrap() {
  const app = await NestFactory.create(FetcherModule);
  app.enableShutdownHooks();          // so consumers stop cleanly on Ctrl+C
  await app.listen(3000);
  new Logger('Fetcher').log('fetcher listening on :3000');
}
bootstrap();
```

---

## 7. App `parser` (the Parsing worker)

### `dedup.service.ts`

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@app/common';

/**
 * Content-level dedup. Different URLs often serve the same page
 * (example.com vs www.example.com, mirrors, copy-paste sites).
 *
 * A Bloom filter may wrongly say "seen" for something new (false positive),
 * but it never says "new" for something it has really seen. For dedup that
 * trade-off is fine: we lose a tiny number of pages and save a lot of memory.
 */
@Injectable()
export class DedupService implements OnModuleInit {
  static readonly HTML_FILTER = 'bloom:html';
  static readonly TEXT_FILTER = 'bloom:text';

  private readonly logger = new Logger(DedupService.name);

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    for (const filter of [DedupService.HTML_FILTER, DedupService.TEXT_FILTER]) {
      try {
        await this.redis.reserveBloom(filter);
      } catch (err: any) {
        this.logger.warn(
          `Could not reserve ${filter} (${err?.message}). ` +
          `Is RedisBloom loaded? Use the redis/redis-stack image.`,
        );
      }
    }
  }

  /** true = new content, false = duplicate, skip it. */
  markIfNew(filter: string, hash: string): Promise<boolean> {
    return this.redis.bloomMarkIfNew(filter, hash);
  }
}
```

### `html-parser.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { crawlerConfig } from '@app/common';

export interface ParsedPage {
  title: string;
  text: string;
  links: string[];
}

@Injectable()
export class HtmlParserService {
  constructor(@Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>) {}

  parse(html: Buffer, baseUrl: string): ParsedPage {
    const $ = cheerio.load(html.toString('utf8'));

    // remove everything that is not real content
    $('script, style, noscript, nav, footer, header, form, iframe').remove();

    const title = $('title').first().text().trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const links = new Set<string>();
    $('a[href]').each((_, el) => {
      if (links.size >= this.cfg.maxLinksPerPage) return false;
      const href = $(el).attr('href');
      if (!href) return;
      try {
        // cheerio gives relative hrefs, so resolve them against the page URL
        const abs = new URL(href, baseUrl);
        if (abs.protocol === 'http:' || abs.protocol === 'https:') {
          links.add(abs.toString());
        }
      } catch {
        // broken href, ignore
      }
    });

    return { title, text, links: [...links] };
  }
}
```

### `parsing.consumer.ts`

```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Message } from '@aws-sdk/client-sqs';
import { Consumer } from 'sqs-consumer';
import {
  crawlerConfig, ParseMessage, S3Service, sha256,
  SqsService, startConsumers, UrlEntity, UrlService, UrlStatus,
} from '@app/common';
import { DedupService } from './dedup.service';
import { HtmlParserService } from './html-parser.service';

@Injectable()
export class ParsingConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ParsingConsumer.name);
  private consumers: Consumer[] = [];

  constructor(
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    private readonly htmlParser: HtmlParserService,
    private readonly dedup: DedupService,
    private readonly urlService: UrlService,
    @InjectRepository(UrlEntity) private readonly urlRepo: Repository<UrlEntity>,
    @Inject(crawlerConfig.KEY) private readonly cfg: ConfigType<typeof crawlerConfig>,
  ) {}

  async onModuleInit() {
    const queueUrl = await this.sqs.queueUrl(this.cfg.parsingQueue);
    this.consumers = startConsumers({
      name: 'ParsingConsumer',
      queueUrl,
      sqs: this.sqs.client,
      concurrency: this.cfg.parseConcurrency,
      handler: (message) => this.handle(message),
    });
  }

  onModuleDestroy() {
    this.consumers.forEach((c) => c.stop());
  }

  private async handle(message: Message): Promise<void> {
    const body: ParseMessage = JSON.parse(message.Body!);
    const receipt = message.ReceiptHandle!;
    const queue = this.cfg.parsingQueue;

    try {
      // 1. get the HTML back from S3 (it was never in the queue)
      const html = await this.s3.getHtml(body.s3HtmlKey);

      // 2. cheapest check first: exactly the same bytes
      const htmlHash = sha256(html);
      if (!(await this.dedup.markIfNew(DedupService.HTML_FILTER, htmlHash))) {
        this.logger.debug(`duplicate html, skip ${body.url}`);
        await this.urlService.markStatus(body.urlId, UrlStatus.SKIPPED_DUPLICATE);
        return this.sqs.ack(queue, receipt);
      }

      // 3. extract
      const page = this.htmlParser.parse(html, body.url);

      // 4. second check on the text: catches pages differing only in ads or timestamps
      const textHash = sha256(page.text);
      if (!(await this.dedup.markIfNew(DedupService.TEXT_FILTER, textHash))) {
        this.logger.debug(`duplicate text, skip ${body.url}`);
        await this.urlService.markStatus(body.urlId, UrlStatus.SKIPPED_DUPLICATE);
        return this.sqs.ack(queue, receipt);
      }

      // 5. save the text and update metadata
      const textKey = await this.s3.putText(body.urlId, page.text);
      await this.urlRepo.update(
        { id: body.urlId },
        { s3TextKey: textKey, contentHash: textHash, status: UrlStatus.PARSED },
      );

      // 6. push new links back to the frontier queue
      let added = 0;
      for (const link of page.links) {
        if (await this.urlService.enqueueIfNew(link, body.depth + 1)) added++;
      }
      this.logger.debug(`parsed ${body.url} (${page.text.length} chars, ${added} new links)`);

      return this.sqs.ack(queue, receipt);
    } catch (err: any) {
      this.logger.warn(`parse error ${body.url}: ${err?.message}`);
      await this.urlService.markFailed(body.urlId, err?.message ?? 'unknown');
      throw err;   // no ack -> SQS retries, then DLQ
    }
  }
}
```

### `parser.module.ts` and `main.ts`

```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '@app/common';
import { DedupService } from './dedup.service';
import { HtmlParserService } from './html-parser.service';
import { ParsingConsumer } from './parsing.consumer';

@Module({
  imports: [CommonModule],
  providers: [DedupService, HtmlParserService, ParsingConsumer],
})
export class ParserModule {}
```

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ParserModule } from './parser.module';

async function bootstrap() {
  // No HTTP server needed — this is a pure worker
  const app = await NestFactory.createApplicationContext(ParserModule);
  app.enableShutdownHooks();
  new Logger('Parser').log('parser worker started');
}
bootstrap();
```

---

## 8. How to run

```bash
# 1. infrastructure (same compose file as the Java version)
docker compose up -d
docker compose logs -f localstack     # wait for "== done =="

# 2. dependencies + schema
npm install
npm run migration:run

# 3. two terminals
npm run start:fetcher
npm run start:parser

# 4. give it seed URLs
curl -X POST http://localhost:3000/api/v1/seeds \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://nestjs.com","https://en.wikipedia.org/wiki/Web_crawler"]}'

# 5. watch it work
curl http://localhost:3000/api/v1/stats
```

---

## 9. Things that are genuinely different from the Java version

These are worth understanding, not just copying.

**Concurrency model.** Java used virtual threads: each fetch looked synchronous but did not block a real thread. Node has no threads at all for this — it has one event loop and `async/await`. The result is similar (thousands of concurrent I/O operations, very little memory), but the failure mode is different: in Java a slow CPU task blocks one thread, in Node it blocks *everything*.

**This matters for the parser.** `cheerio.load()` on a 2MB page is CPU work, and while it runs, your event loop cannot accept new messages, answer health checks, or finish other requests. Three options, in order of effort:

- Keep `parseConcurrency` low and run more parser processes (simplest, works fine)
- Use Node's `cluster` module or PM2 in cluster mode
- Move parsing into `worker_threads`, ideally through the `piscina` library

The fetcher does not have this problem — it is pure I/O, which is exactly what Node is best at.

**Transactions are simpler.** In Spring, `@Transactional` on a method called from inside the same class silently does nothing, because the proxy never sees the call. TypeORM's `dataSource.transaction(async (manager) => ...)` has no proxies and no such trap — what you write is what runs. This is one place where the NestJS version is genuinely less error-prone.

**Bigint columns come back as strings.** `node-postgres` returns `BIGINT` as a JavaScript string, because a 64-bit integer does not fit safely in a JS number. That is why `UrlEntity.id` is typed `string`. Do not "fix" this by calling `Number()` on it in the wrong place.

**No BOM / dependency management.** Java's `dependencyManagement` block aligns all AWS SDK versions for you. npm does not do this, so keep the two `@aws-sdk/*` packages on the same version manually, or you will hit strange type errors.

## 10. Scaling notes

The reasoning from the design does not change: roughly 8 network-optimised machines finish 10B pages in under 5 days, assuming ~3,750 pages/second each.

What changes in a Node deployment:

| Concern | Approach |
|---|---|
| Using all CPU cores | One Node process uses one core. Run `cluster`/PM2, or just deploy more pods — pods are simpler and scale the same way |
| Fetcher scaling | Autoscale on `ApproximateNumberOfMessagesVisible` of `frontier-queue` |
| Parser scaling | Same metric on `parsing-queue`, but watch event-loop lag as your real signal |
| Bloom filter memory | 10B items at 0.1% error needs ~18GB. Shard by hash prefix (`bloom:text:00` … `bloom:text:ff`) across a Redis cluster |
| ElastiCache has no RedisBloom | Run `redis/redis-stack` yourself, use Redis Cloud, or fall back to the `content_hash` index in Postgres |
| Metrics | Add `@willsoto/nestjs-prometheus`, and export event-loop lag, pages/sec, fetch error rate, and queue depth |

## 11. Checklist

- [x] Fault tolerance → pipeline split, `shouldDeleteMessages: false`, visibility timeout, DLQ
- [x] Politeness → robots.txt, Crawl-delay, Redis domain lock, 1 req/sec sliding window, jitter
- [x] Efficiency → URL dedup (`orIgnore`), content dedup (Bloom), DNS cache, HEAD size check, gzip
- [x] Scale → stateless workers, queue-depth autoscaling, sharded S3 keys
- [x] Crawler traps → `depth` column + `maxDepth`
- [x] No big payloads in the queue → only IDs and S3 keys travel through SQS
