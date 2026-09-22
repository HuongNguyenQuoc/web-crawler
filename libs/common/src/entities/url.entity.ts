import {
    Column, CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,  
} from 'typeorm';
import { UrlStatus } from './url-status.enum';

@Entity('url')
export class UrlEntity {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string; // bigint comes back as string in node-postgres

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
    @Column( { name: 'content_hash', type: 'char', length: 64, nullable: true })
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