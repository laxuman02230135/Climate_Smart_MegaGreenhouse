import type { NextRequest, NextResponse } from 'next/server';
import { getHub } from '@/lib/server/prototype-hub';
import { guard, respond } from '@/lib/server/prototype-api';

export const dynamic = 'force-dynamic';

/** Opens a commissioning window: the app waits for this device's JOIN_REQUEST. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ deviceId: string }> },
): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const { deviceId } = await ctx.params;
  return respond(() => getHub().engine.commission(deviceId));
}
