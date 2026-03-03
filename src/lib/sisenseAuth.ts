import { sanitizeBearerToken } from '@/lib/network';

export interface SisenseAuthInput {
  token?: string;
  username?: string;
  password?: string;
}

export function hasSisenseAuth(auth: SisenseAuthInput): boolean {
  return Boolean(auth.token?.trim() || (auth.username?.trim() && auth.password));
}

export async function resolveSisenseBearer(
  baseUrl: string,
  auth: SisenseAuthInput
): Promise<string> {
  const directToken = auth.token?.trim();
  if (directToken) {
    return sanitizeBearerToken(directToken);
  }

  const username = auth.username?.trim();
  const password = auth.password;

  if (!username || !password) {
    throw new Error('Missing Sisense authentication credentials');
  }

  const response = await fetch(`${baseUrl}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as { access_token?: string; token?: string; message?: string; error?: { message?: string } })
    : ({ message: await response.text() } as { message?: string; error?: { message?: string } });

  if (!response.ok) {
    const message =
      payload.error?.message ?? payload.message ?? `Sisense login failed (${response.status})`;
    throw new Error(message);
  }

  const resolvedToken = payload.access_token ?? payload.token;
  if (!resolvedToken?.trim()) {
    throw new Error('Sisense login succeeded but no bearer token was returned');
  }

  return sanitizeBearerToken(resolvedToken);
}
