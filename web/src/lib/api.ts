import { hardNavigate } from './navigation';

type ApiErrorBody = {
  code?: string;
  message?: string;
  details?: { field: string; message: string }[];
};

export const CSRF_HEADER = 'x-greenhouse-csrf';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { field: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onSessionExpired: () => void = () => hardNavigate('/prototype-testing/login?expired=1');

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    res.status,
    body?.code ?? `HTTP_${res.status}`,
    body?.message ?? res.statusText,
    body?.details ?? [],
  );
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { [CSRF_HEADER]: '1', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401) onSessionExpired();
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
