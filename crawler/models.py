import enum
from datetime import date, datetime
from venv import create
from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
  pass

class UrlStatus(str, enum.Enum):
  PENDING = "PENDING"
  FETCHED = "FETCHED"
  PARSED = "PARSED"
  SKIPPED_ROBOTS = "SKIPPED_ROBOTS"
  SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"
  SKIPPED_TOO_LARGE = "SKIPPED_TOO_LARGE"
  SKIPPED_TOO_DEPTH = "SKIPPED_TOO_DEPTH"
  FAILED = "FAILED"

class Url(Base):
  __tablename__ = "url"

  id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
  url: Mapped[str] = mapped_column(Text, nullable=False)
  url_hash: Mapped[str] = mapped_column(String(64), nullable=False)
  domain: Mapped[str] = mapped_column(String(255), nullable=False)
  depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
  status: Mapped[str] = mapped_column(String(32), default=UrlStatus.PENDING, nullable=False)

  s3_html_key: Mapped[str | None] = mapped_column(String(512))
  s3_text_key: Mapped[str | None] = mapped_column(String(512))
  content_hash: Mapped[str | None] = mapped_column(String(64))

  retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
  error_message: Mapped[str | None] = mapped_column(String(1000))
  last_crawl_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

  __table_args__ = (
    Index("idx_url_hash", "url_hash", unique=True) # This is our URL-level dedup
    Index()
  )

