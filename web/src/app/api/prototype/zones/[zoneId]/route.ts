import type { NextRequest, NextResponse } from 'next/server';
import { getHub } from '@/lib/server/prototype-hub';
import { guard, readJson, respond } from '@/lib/server/prototype-api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ zoneId: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const { zoneId } = await ctx.params;
  const body = await readJson(req);
  return respond(() => getHub().engine.updateSettings(zoneId, body));
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const { zoneId } = await ctx.params;
  return respond(() => getHub().engine.removeZone(zoneId));
}
