import { NextResponse, type NextRequest } from 'next/server';
import { csrfRejected, errorJson } from '@/lib/server/http';
import {
  checkTestCredentials,
  prototypeCookie,
  prototypeLoginEnabled,
} from '@/lib/server/prototype-auth';

/** Development-only mock sign-in for the Prototype Testing Lab. Never touches the backend. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfRejected(req);
  if (blocked) return blocked;
  if (!prototypeLoginEnabled()) {
    return errorJson(403, 'PROTOTYPE_DISABLED', 'The prototype test login is turned off');
  }
  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return errorJson(400, 'VALIDATION_FAILED', 'Enter a username and password');
  }
  if (!checkTestCredentials(username, password)) {
    return errorJson(401, 'INVALID_CREDENTIALS', 'Incorrect test username or password');
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(prototypeCookie());
  return res;
}
