import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

export const CSRF_HEADER = 'x-greenhouse-csrf';

export function errorJson(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, code, message }, { status });
}

/**
 * CSRF defence in depth for the prototype API. Mutating requests need a custom
 * same-origin header, which an ordinary cross-site form cannot set.
 */
export function csrfRejected(req: NextRequest): NextResponse | null {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  if (req.headers.get(CSRF_HEADER) !== '1') return errorJson(403, 'CSRF', 'Request blocked');

  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    try {
      if (new URL(origin).host !== host) return errorJson(403, 'CSRF', 'Request blocked');
    } catch {
      return errorJson(403, 'CSRF', 'Request blocked');
    }
  }
  return null;
}
