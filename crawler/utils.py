import hashlib
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PREFIXES = ("utm_", "fbclid", "gclid", "msclkid", "ref_src")

def normalize_url(raw: str) -> str | None:
    """
    Produce one canonical form of a URL so that two links pointing at the same
    page produce the same hash. Returns None for anything that is not a normal
    http(s) page (mailto:, javascript:, ftp: ...).
    """
    if not raw or not raw.strip():
        return None

    try:
        parts = urlsplit(raw.strip())
    except ValueError:
        return None

    schema = parts.scheme.lower()
    if schema not in ("http", "https"):
        return None
    if not parts.hostname:
        return None

    host = parts.hostname.lower()
    if host.startswith("www."):
        host = host[4:]

    port = parts.port
    is_default = port is None or (schema == "http" and port == 80) or (schema == "https" and port == 443)
    netloc = host if is_default else f"{host}:{port}"

    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    # drop tracking params, then sort the rest so order does not matter
    params = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(TRACKING_PREFIXES)
    ]
    query = urlencode(sorted(params))

    # the empty last element drops the #fragment
    return urlunsplit((schema, netloc, path, query, ""))
    
def domain_of(normalized_url: str) -> str:
    return urlsplit(normalized_url).hostname or ""

def sha256_hash(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()