'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

export function PrototypeSignupForm() {
  return (
    <main className="proto-auth-bg relative grid min-h-dvh place-items-center px-4 py-10">
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandMark className="size-24 rounded-3xl bg-white/95 p-3 shadow-xl" priority />
        </div>

        <div className="rounded-2xl border border-white/60 bg-surface/95 p-6 shadow-2xl backdrop-blur-md">
          <h1 className="text-xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-text-2">Join your greenhouse workspace.</p>

          <p className="mt-5 rounded-lg bg-info-soft p-3 text-sm text-info-fg">
            Account registration is not connected yet. Use the test account provided for this
            prototype to sign in.
          </p>

          <form className="mt-5 flex flex-col gap-4">
            <Field id="signup-name" label="Full name">
              <Input id="signup-name" autoComplete="name" disabled />
            </Field>
            <Field id="signup-email" label="Email">
              <Input id="signup-email" type="email" autoComplete="email" disabled />
            </Field>
            <Field id="signup-password" label="Password">
              <Input id="signup-password" type="password" autoComplete="new-password" disabled />
            </Field>
            <Button type="button" size="lg" disabled className="w-full">
              Sign-up unavailable
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-text-2">
            Already have access?{' '}
            <Link href="/prototype-testing/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
