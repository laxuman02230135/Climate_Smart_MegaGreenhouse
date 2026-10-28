import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PrototypeDashboard } from '@/components/prototype/prototype-dashboard';
import { isPrototypeSession, PROTOTYPE_COOKIE } from '@/lib/server/prototype-auth';

export const metadata: Metadata = { title: 'Prototype Testing Lab' };

export default async function PrototypeTestingPage() {
  const jar = await cookies();
  if (!isPrototypeSession(jar.get(PROTOTYPE_COOKIE)?.value)) redirect('/prototype-testing/login');
  return <PrototypeDashboard />;
}
