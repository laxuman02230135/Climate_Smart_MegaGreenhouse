import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { EngineError } from '@/lib/prototype/engine';
import { csrfRejected, errorJson } from './http';
import { isPrototypeSession, PROTOTYPE_COOKIE } from './prototype-auth';

/** Shared checks for the live-lab API: prototype sign-in, CSRF, and error mapping. */
export async function guard(req: NextRequest): Promise<NextResponse | null> {
  const jar = await cookies();
  if (!isPrototypeSession(jar.get(PROTOTYPE_COOKIE)?.value))
    return errorJson(401, 'UNAUTHENTICATED', 'Sign in to the Prototype Testing Lab first');
  return csrfRejected(req);
}

export async function readJson(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => ({}));
}

/** Runs an engine action, turning EngineError into a JSON error response. */
export function respond<T>(fn: () => T, status = 200): NextResponse {
  try {
    const result = fn();
    return NextResponse.json(result ?? null, { status, headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof EngineError) return errorJson(e.status, e.code, e.message);
    throw e;
  }
}
