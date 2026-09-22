import { registerAs } from '@nestjs/config';

export const crawlerConfig = registerAs('crawler', () => ({
    // stop following links after a certain depth
    maxDepth: Number(process.env.CRAWLER_MAX_DEPTH ?? 15),

    // never hit one domain faster than this, even if robots.txt allows it
    minCrawlDelayMs: Number(process.env.CRAWLER_MIN_DELAY_MS ?? 1000),
    defaultCrawlDelayMs: Number(process.env.CRAWLER_DEFAULT_DELAY_MS ?? 1000),

    maxPageBytes: Number(process.env.CRAWLER_MAX_PAGE_BYTES ?? 10 * 1024 * 1024), // 10 MB
    maxLinksPerPage: Number(process.env.CRAWLER_MAX_LINKS_PER_PAGE ?? 500),

    userAgent: process.env.CRAWLER_USER_AGENT ?? 'HuongCrawlerBot/1.0 (+https://example.com/bot)',
    robotsAgentName: process.env.CRAWLER_ROBOTS_AGENT ?? 'HuongCrawlerBot',

    requestTimeoutMs: Number(process.env.CRAWLER_TIMEOUT_MS ?? 15000), // 15 seconds
    dnsCacheTtlSec: Number(process.env.CRAWLER_DNS_TTL_SEC ?? 6 * 3600), // 6 hours
    robotsTtlSec: Number(process.env.CRAWLER_ROBOTS_TTL_SEC ?? 24 * 3600), // 24 hours

    htmlBucket: process.env.CRAWLER_HTML_BUCKET ?? 'crawler-html',
    textBucket: process.env.CRAWLER_TEXT_BUCKET ?? 'crawler-text',
    frontierQueue: process.env.CRAWLER_FRONTIER_BUCKET ?? 'frontier-queue',
    parsingQueue: process.env.CRAWLER_PARSING_BUCKET ?? 'parsing-queue',

    fetchConcurrency: Number(process.env.CRAWLER_FETCH_CONCURRENCY ?? 5), // Number of current fetches to perform
    parseConcurrency: Number(process.env.CRAWLER_PARSE_CONCURRENCY ?? 2), // Number of current parses to perform
    bloomCapacity: Number(process.env.CRAWLER_BLOOM_CAPACITY ?? 10_000_000), // Number of URLs to store in the bloom filter
    bloomErrorRate: Number(process.env.CRAWLER_BLOOM_ERROR_RATE ?? 0.001), // False positive rate for the bloom filter
}));

export const awsConfig = registerAs('aws', () => ({
    region: process.env.AWS_REGION ?? 'ap-southeast-1',
    // Localstack only. Leave it undefined to talk to real AWS services.
    endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    forcePathStyle: true, // Localstack only. Leave it undefined to talk to real AWS services.
}));
