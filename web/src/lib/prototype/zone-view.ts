import type { DisplayStatus, ZoneState } from './engine';
import type { SensorKind } from './types';

/**
 * How a zone is described to the tester. Pure functions over the server snapshot, shared by the
 * panels and the 3D scene so both always say the same thing. Nothing here fills in a value the
 * node has not sent.
 */

export type LinkState = 'online' | 'offline' | 'waiting' | 'error';

export const STATUS_TEXT: Record<DisplayStatus, string> = {
  Online: 'Online',
  Offline: 'Offline',
  Error: 'Error',
  Joining: 'Joining',
  Registered: 'Waiting for connection',
};

export const NO_READING = 'No reading available';

export function linkOf(status: DisplayStatus): LinkState {
  if (status === 'Online') return 'online';
  if (status === 'Offline') return 'offline';
  if (status === 'Error') return 'error';
  return 'waiting';
}

/** Lowest free ID such as ZONE-03, so gaps left by removed zones are reused. */
export function nextId(prefix: string, taken: readonly string[], width: number): string {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  for (let i = 1; ; i++) {
    const id = `${prefix}-${String(i).padStart(width, '0')}`;
    if (!used.has(id)) return id;
  }
}

const FORMAT: Record<SensorKind, (v: number) => string> = {
  temperature: (v) => `${v.toFixed(1)} °C`,
  soilMoisture: (v) => `${Math.round(v)} %`,
  light: (v) => `${Math.round(v)} ADC`,
};

/** A received value, or why there is none. */
export function readingText(zone: ZoneState, kind: SensorKind): string {
  if (!zone.device.supportedSensors.includes(kind)) return 'Not fitted on this node';
  const s = zone.sensors[kind];
  if (!s) return NO_READING;
  return `${FORMAT[kind](s.value)}${s.source === 'test' ? ' (test)' : ''}${s.freshness === 'stale' ? ' (stale)' : ''}`;
}

/** The value for the scene, only when the node actually sent one. */
export function readingValue(zone: ZoneState, kind: SensorKind): number | null {
  return zone.sensors[kind]?.value ?? null;
}

/** Light state as confirmed by the node. A request alone never counts as ON or OFF. */
export function lightText(zone: ZoneState): string {
  if (!zone.light.supported) return 'No light fitted';
  if (zone.light.command?.status === 'pending')
    return `${zone.light.command.requestedAction} requested, awaiting confirmation`;
  if (zone.light.reportedState) return zone.light.reportedState;
  return zone.device.status === 'Online' ? 'State not reported yet' : 'Waiting for connection';
}
