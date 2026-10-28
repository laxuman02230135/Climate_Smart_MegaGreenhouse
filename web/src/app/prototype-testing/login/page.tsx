import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  isPrototypeSession,
  PROTOTYPE_COOKIE,
  prototypeLoginEnabled,
} from '@/lib/server/prototype-auth';
import { PrototypeLoginForm } from './login-form';

export const metadata: Metadata = { title: 'Prototype test sign-in' };

export default async function PrototypeLoginPage() {
  const jar = await cookies();
  if (isPrototypeSession(jar.get(PROTOTYPE_COOKIE)?.value)) redirect('/prototype-testing');
  return <PrototypeLoginForm enabled={prototypeLoginEnabled()} />;
}
