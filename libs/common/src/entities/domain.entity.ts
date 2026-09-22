import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

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
