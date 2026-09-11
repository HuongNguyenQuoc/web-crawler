from alembic import op

revision = "0001"
down_revision = None

def upgrade() -> None:
    op.execute("""
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
        )
    """)
op.execute("CREATE UNIQUE INDEX ux_url_hash ON url (url_hash)")
op.execute("CREATE INDEX ix_url_content_hash ON url (content_hash)")
op.execute("CREATE INDEX ix_url_status ON url (status)")
op.execute("CREATE INDEX ix_url_domain ON url (domain)")

op.execute("""
    CREATE TABLE domain (
        domain         VARCHAR(255) PRIMARY KEY,
        robots_txt     TEXT,
        crawl_delay_ms BIGINT       NOT NULL DEFAULT 1000,
        robots_fetched_at TIMESTAMPTZ,
        last_crawl_time TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
""")

def downgrade() -> None:
    op.execute("DROP TABLE domain")
    op.execute("DROP TABLE url")
