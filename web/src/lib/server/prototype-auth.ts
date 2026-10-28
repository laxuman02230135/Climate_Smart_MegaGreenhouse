import 'server-only';

/**
 * DEVELOPMENT-ONLY mock sign-in for the Prototype Testing Lab. It is separate from the admin
 * sign-in (different cookie, no backend token, no admin permissions) and only unlocks the
 * prototype dashboard. It is not production security: it is off in production builds unless
 * PROTOTYPE_LOGIN=true, and the credentials never reach the browser bundle.
 */
export const PROTOTYPE_COOKIE = 'gh_proto';
const SESSION_VALUE = 'test-user';
const MAX_AGE_S = 8 * 60 * 60;

const TEST_USERNAME = process.env.PROTOTYPE_USERNAME ?? 'test';
const TEST_PASSWORD = process.env.PROTOTYPE_PASSWORD ?? 'test123';

export function prototypeLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.PROTOTYPE_LOGIN === 'true';
}

export function checkTestCredentials(username: string, password: string): boolean {
  return username === TEST_USERNAME && password === TEST_PASSWORD;
}

export function isPrototypeSession(value: string | undefined): boolean {
  return prototypeLoginEnabled() && value === SESSION_VALUE;
}

export function prototypeCookie() {
  return {
    name: PROTOTYPE_COOKIE,
    value: SESSION_VALUE,
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: MAX_AGE_S,
  };
}
