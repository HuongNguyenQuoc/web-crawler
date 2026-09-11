from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=".env", env_prefix="CRAWLER_", extra="ignore")

  #-- crawl behaviour
  max_depth: int = 15 # stop following links after this many hops
  min_crawl_delay_ms: int = 1000 # never faster than this, even if robots.txt allows
  default_crawl_delay_ms: int = 1000
  max_page_bytes: int = 10 * 1024 * 1024 # 10 MB
  max_links_per_page: int = 500

  user_agent: str = "HuongCrawlerBot/1.0 (+https://example.com/bot)"
  robots_agent_name: str = "HuongCrawlerBot"

  request_timeout_sec: int = 15
  dns_cache_ttl_sec: int = 6 * 3600 # 6 hours
  robots_ttl_sec: int = 24 * 3600 # 24 hours

  # --resources--
  html_bucket: str = "crawler-html"
  text_bucket: str = "crawler-text"
  frontier_queue: str = "frontier-queue"
  parsing_queue: str = "parsing-queue"

  fetch_concurrency: int = 50
  parse_concurrency: int = 10

  bloom_capacity: int = 10_000_000
  bloom_error_rate: float = 0.001

  # -- infrastructure --
  database_url: str = "postgresql+asyncpg://crawler:crawler@localhost:5432/crawler"
  redis_url: str = "redis://localhost:6379/0"

  aws_region: str = "ap-southeast-1"
  aws_endpoint_url: str | None = "http://localhost:4566" # for localstack
  aws_access_key_id: str | None = "test"
  aws_secret_access_key: str | None = "test"

@lru_cache
def get_settings() -> Settings:
  return Settings()