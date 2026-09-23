import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1700000000000 implements MigrationInterface {
    name = 'InitSchema1700000000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`
            CREATE TABLE url (
                id BIGSERIAL PRIMARY KEY,
                url TEXT NOT NULL,
                url_hash CHAR(64) NOT NULL,
                domain VARCHAR(255) NOT NULL,
                depth INT NOT NULL DEFAULT 0,
                status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                s3_html_key VARCHAR(512),
                s3_text_key VARCHAR(512),
                content_hash CHAR(64),
                retry_count INT NOT NULL DEFAULT 0,
                error_message VARCHAR(1000),
                last_crawl_time TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);

        await q.query(`
            CREATE UNIQUE INDEX ux_url_hash ON url (url_hash)`);
        await q.query(`CREATE INDEX ix_url_content_hash ON url (content_hash)`);
        await q.query(`CREATE INDEX ix_url_status ON url (status)`);
        await q.query(`CREATE INDEX ix_url_domain ON url (domain)`);

        await q.query(`
            CREATE TABLE domain (
                domain VARCHAR(255) PRIMARY KEY,
                robots_txt TEXT,
                crawl_delay_ms BIGINT NOT NULL DEFAULT 1000,
                robots_fetched_at TIMESTAMPTZ,
                last_crawl_time TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE domain`);
        await q.query(`DROP TABLE url`);
    }
}