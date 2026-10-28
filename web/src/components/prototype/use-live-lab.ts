'use client';

import { useCallback, useEffect, useState } from 'react';
import { CSRF_HEADER } from '@/lib/api';
import type { AddZoneInput, LightCommand, ZoneSettings, ZoneState } from '@/lib/prototype/engine';

/**
 * Client for the live (EMQX) side of the lab. It polls the server's snapshot; every value in it
 * comes from MQTT messages the backend received, never from the browser.
 */
export interface LiveState {
  greenhouse: { id: string; name: string };
  gateway: { id: string; status: 'Online' | 'Offline' | 'Unknown'; lastSeen: number | null };
  zones: ZoneState[];
  unassignedDevices: { deviceId: string; deviceName: string; supportedSensors: string[] }[];
  events: { at: number; level: 'info' | 'warn'; text: string }[];
  mqtt: {
    status:
      'not-configured' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
    host: string | null;
    port: number | null;
    clientId: string | null;
    missing: string[];
    lastConnectedAt: number | null;
    lastError: string | null;
  };
  serverTime: number;
}

export class LiveError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(method !== 'GET' ? { [CSRF_HEADER]: '1' } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new LiveError(b?.code ?? `HTTP_${res.status}`, b?.message ?? res.statusText);
  }
  return (await res.json().catch(() => null)) as T;
}

const POLL_MS = 2000;

export function useLiveLab(enabled: boolean) {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    async function load() {
      try {
        const s = await call<LiveState>('/api/prototype/state');
        if (!stop) {
          setState(s);
          setError(null);
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : 'Could not load live state');
      }
    }
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [enabled, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const zones = state?.zones ?? [];
  const selected = zones.find((z) => z.zoneId === selectedId) ?? zones[0] ?? null;

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  return {
    state,
    error,
    zones,
    selected,
    selectZone: setSelectedId,
    addZone: (input: AddZoneInput) =>
      run(() => call<unknown>('/api/prototype/zones', 'POST', input)),
    removeZone: (zoneId: string) =>
      run(() => call<unknown>(`/api/prototype/zones/${zoneId}`, 'DELETE')),
    saveSettings: (zoneId: string, s: Partial<ZoneSettings>) =>
      run(() => call<unknown>(`/api/prototype/zones/${zoneId}`, 'PATCH', s)),
    sendLight: (zoneId: string, action: 'ON' | 'OFF') =>
      run(() => call<LightCommand>(`/api/prototype/zones/${zoneId}/light`, 'POST', { action })),
    commission: (deviceId: string) =>
      run(() => call<unknown>(`/api/prototype/devices/${deviceId}/commission`, 'POST')),
    removeDevice: (deviceId: string) =>
      run(() => call<unknown>(`/api/prototype/devices/${deviceId}`, 'DELETE')),
  };
}

export type LiveLab = ReturnType<typeof useLiveLab>;
