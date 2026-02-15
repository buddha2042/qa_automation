export function sanitizeBearerToken(token: string): string {
  return token.replace(/^Bearer\s+/i, '').trim();
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    isPrivateIpv4(hostname)
  );
}

export function normalizeBaseUrl(input: string): string {
  const candidate = input.trim();
  const parsed = new URL(candidate);

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are allowed');
  }

  const allowLocal = process.env.ALLOW_LOCAL_URLS === 'true';
  if (!allowLocal && isLocalHost(parsed.hostname)) {
    throw new Error('Local/private network URLs are blocked by default');
  }

  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/$/, '');
}
