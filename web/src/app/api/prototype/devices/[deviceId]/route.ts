import type { NextRequest, NextResponse } from 'next/server';
import { getHub } from '@/lib/server/prototype-hub';
import { guard, respond } from '@/lib/server/prototype-api';

export const dynamic = 'force-dynamic';

/** Removes a registered device that is not assigned to any zone. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ deviceId: string }> },
): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const { deviceId } = await ctx.params;
  return respond(() => getHub().engine.removeDevice(deviceId));
}
