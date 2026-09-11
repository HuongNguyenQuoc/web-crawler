from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from crawler.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,  # drop head connections instead of crashing on them
    echo=False,
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
