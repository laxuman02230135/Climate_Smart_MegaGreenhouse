import type { NextRequest, NextResponse } from 'next/server';
import { EngineError } from '@/lib/prototype/engine';
import { getHub } from '@/lib/server/prototype-hub';
import { guard, readJson, respond } from '@/lib/server/prototype-api';

export const dynamic = 'force-dynamic';

/** Publishes a light command for ONE zone's device. The result is a request, not confirmation. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ zoneId: string }> },
): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const { zoneId } = await ctx.params;
  const body = (await readJson(req)) as { action?: unknown };
  return respond(() => {
    if (body.action !== 'ON' && body.action !== 'OFF')
      throw new EngineError(400, 'VALIDATION_FAILED', 'action must be ON or OFF');
    return getHub().sendLight(zoneId, body.action);
  }, 202);
}
