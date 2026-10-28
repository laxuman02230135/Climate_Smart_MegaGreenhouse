import { NextResponse, type NextRequest } from 'next/server';
import { getHub } from '@/lib/server/prototype-hub';
import { guard } from '@/lib/server/prototype-api';

export const dynamic = 'force-dynamic';

/** Snapshot of the live lab: MQTT/gateway status, zones, readings, light commands, recent events. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  return NextResponse.json(getHub().getState(), { headers: { 'cache-control': 'no-store' } });
}
