'use client';

import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ApiError, postJson } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect test username or password.',
  PROTOTYPE_DISABLED: 'The prototype test login is turned off on this server.',
  VALIDATION_FAILED: 'Enter both the username and the password.',
};

export function PrototypeLoginForm({ enabled }: { enabled: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = {
      username: username.trim() ? undefined : 'Enter the test username.',
      password: password ? undefined : 'Enter the test password.',
    };
    setFieldErrors(errs);
    setError(null);
    if (errs.username || errs.password) return;
    setBusy(true);
    try {
      await postJson('/api/prototype/login', { username: username.trim(), password });
      hardNavigate('/prototype-testing');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNREACHABLE';
      setError(MESSAGES[code] ?? 'Could not sign in. Check the dashboard server is running.');
      setBusy(false);
    }
  }

  return (
    <main className="proto-auth-bg relative grid min-h-dvh place-items-center px-4 py-10">
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandMark className="size-24 rounded-3xl bg-white/95 p-3 shadow-xl" priority />
        </div>

        <div className="rounded-2xl border border-white/60 bg-surface/95 p-6 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">Welcome back</h1>
          </div>
          <p className="mt-1 text-sm text-text-2">Sign in to your greenhouse workspace.</p>

          {!enabled ? (
            <div
              role="alert"
              className="mt-5 flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning-fg"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{MESSAGES.PROTOTYPE_DISABLED}</span>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
              <Field id="proto-username" label="Username" error={fieldErrors.username}>
                <Input
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={64}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="proto-password" className="text-sm font-medium text-text">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="proto-password"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={128}
                    className="pr-11"
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? 'proto-password-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted hover:text-text"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="proto-password-error" className="text-sm text-critical-fg">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex gap-2 rounded-lg bg-critical-soft p-3 text-sm text-critical-fg"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
                {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              <p className="text-center text-sm text-text-2">
                New here?{' '}
                <Link href="/prototype-testing/signup" className="font-semibold text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
