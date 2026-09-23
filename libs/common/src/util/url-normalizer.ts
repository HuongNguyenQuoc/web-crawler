import { createHash } from 'node:crypto';

const TRACKING_PREFIXES = ['utm_', 'gclid', 'fbclid', 'msclkid', 'dclid', 'igshid', 'mc_cid', 'mc_eid', 'ref_src'];

/**
 * Produce one canonical form of a URL, so that two links pointing at the
 * same page produce the same hash. Returns null for anything that is not
 * a normal http(s) page (mailto:, javascript:, ftp:, ...).
 */
export function normalizeUrl(raw: string): string | null {
    if (!raw?.trim()) return null;

    let u: URL;
    try {
        u = new URL(raw.trim());
    } catch {
        return null;
    }

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    if (!u.hostname) return null;

    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);

    const isDefaultPort =
        !u.port ||
        (u.protocol === 'http:' && u.port === '80') ||
        (u.protocol === 'https:' && u.port === '443');
    
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    // drop tracking params, then sort the rest so order does not matter
    const params = [...u.searchParams.entries()]
        .filter(([k]) => !TRACKING_PREFIXES.some(p => k.toLowerCase().startsWith(p)))
        .sort(([a], [b]) => a.localeCompare(b));

    const query = new URLSearchParams(params).toString();

    // URL ban đầu: https://EXAMPLE.com:443/products?id=123&utm_source=google#reviews
    let out = `${u.protocol}//${host}`;
    if (!isDefaultPort) out += `:${u.port}`;
    out += path; // path: for example like: /products
    if (query) out += `?${query}`; // query: id=123
    return out;   // the #fragment is dropped automatically
}

export function domainOf(normalized: string): string {
    return new URL(normalized).hostname;
}

export function sha256(value: string | Buffer | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
}