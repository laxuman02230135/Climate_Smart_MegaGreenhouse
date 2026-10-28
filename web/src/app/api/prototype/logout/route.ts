import { NextResponse, type NextRequest } from 'next/server';
import { csrfRejected } from '@/lib/server/http';
import { PROTOTYPE_COOKIE } from '@/lib/server/prototype-auth';

/** Ends the prototype test session only; an admin session in the same browser is untouched. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfRejected(req);
  if (blocked) return blocked;
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(PROTOTYPE_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
