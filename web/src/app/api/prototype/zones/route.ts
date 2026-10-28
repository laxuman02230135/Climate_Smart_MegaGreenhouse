import type { NextRequest, NextResponse } from 'next/server';
import { getHub } from '@/lib/server/prototype-hub';
import { guard, readJson, respond } from '@/lib/server/prototype-api';

export const dynamic = 'force-dynamic';

/** Adds a zone to the one greenhouse and assigns (or registers) its device. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const body = await readJson(req);
  return respond(() => getHub().engine.addZone(body), 201);
}
