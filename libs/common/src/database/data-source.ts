import { DataSource } from "typeorm";
import { UrlEntity } from "@app/common/entities/url.entity";
import { DomainEntity } from "@app/common/entities/domain.entity";

export default new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'crawler',
    password: process.env.DB_PASSWORD ?? 'crawler',
    database: process.env.DB_NAME ?? 'crawler',
    entities: [UrlEntity, DomainEntity],
    migrations: ['libs/common/src/database/migrations/*.ts'],
    synchronize: false,  // migrations own the schema, never auto-sync
});