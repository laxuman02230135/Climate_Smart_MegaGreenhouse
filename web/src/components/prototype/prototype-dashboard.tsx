'use client';

import { Box, FlaskConical, Info, Loader2, LogOut, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useNow } from '@/hooks/use-now';
import { postJson } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';
import type { ZoneState } from '@/lib/prototype/engine';
import {
  lightText,
  linkOf,
  readingText,
  readingValue,
  STATUS_TEXT,
  type LinkState,
} from '@/lib/prototype/zone-view';
import { cn } from '@/lib/utils';
import type { MarkerId, SceneMarker, SceneZone } from './greenhouse-scene';
import {
  LiveLightButton,
  LiveLightStatus,
  LiveSensorCards,
  LiveStatusBar,
  LiveZonesPanel,
} from './live-panels';
import { Panel, SectionTitle } from './shared';
import { useLiveLab } from './use-live-lab';

// WebGL only runs in the browser; loading it separately keeps three.js out of the first bundle.
const GreenhouseScene = dynamic(() => import('./greenhouse-scene').then((m) => m.GreenhouseScene), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-text-2">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading 3D greenhouse</span>
    </div>
  ),
});

const MARKER_INFO: Record<MarkerId, string> = {
  temperature: "Temperature from this zone's node, as received over MQTT.",
  soilMoisture: "Soil moisture from this zone's node. Darker soil in the bay means wetter.",
  light: "LDR light level from this zone's node. The sky follows the zones' LDR readings.",
  bulb: 'Glows only when the node confirmed the light is ON (acknowledgement or reported state).',
  relay: 'Green when the node reported ON, red when it reported OFF, grey until it reports.',
  node: 'Node connection, judged from its recent valid messages. Amber means waiting.',
  gateway: 'The Wi-Fi LoRa gateway that carries every zone. Judged from its own heartbeats.',
};

function sceneZone(z: ZoneState): SceneZone {
  const on = z.light.reportedState;
  const readings = (['temperature', 'soilMoisture', 'light'] as const)
    .filter((k) => z.device.supportedSensors.includes(k))
    .map((k) => readingText(z, k));
  const summary = [
    STATUS_TEXT[z.device.status],
    ...readings,
    z.light.supported ? `Light ${on ?? '?'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    zoneId: z.zoneId,
    name: z.name,
    link: linkOf(z.device.status),
    sensors: z.device.supportedSensors,
    hasLight: z.light.supported,
    temperature: readingValue(z, 'temperature'),
    soilMoisture: readingValue(z, 'soilMoisture'),
    light: readingValue(z, 'light'),
    lightOn: on === null ? null : on === 'ON',
    summary,
  };
}

function zoneMarkers(z: ZoneState): SceneMarker[] {
  const has = (k: 'temperature' | 'soilMoisture' | 'light') =>
    z.device.supportedSensors.includes(k);
  const list: (SceneMarker | false)[] = [
    has('temperature') && {
      id: 'temperature',
      label: 'Temperature',
      value: readingText(z, 'temperature'),
    },
    has('soilMoisture') && {
      id: 'soilMoisture',
      label: 'Soil moisture',
      value: readingText(z, 'soilMoisture'),
    },
    has('light') && { id: 'light', label: 'LDR', value: readingText(z, 'light') },
    z.light.supported && { id: 'bulb', label: 'Light bulb', value: lightText(z) },
    z.light.supported && {
      id: 'relay',
      label: 'Relay',
      value: z.light.reportedState ?? 'Not reported',
    },
    { id: 'node', label: z.device.deviceId, value: STATUS_TEXT[z.device.status] },
  ];
  return list.filter((m): m is SceneMarker => !!m);
}

export function PrototypeDashboard() {
  const now = useNow(1000);
  const live = useLiveLab(true);
  const zone = live.selected;
  const [marker, setMarker] = useState<MarkerId | null>(null);
  const [leaving, setLeaving] = useState(false);

  const gw = live.state?.gateway;
  const gatewayLink: LinkState =
    gw?.status === 'Online' ? 'online' : gw?.status === 'Offline' ? 'offline' : 'waiting';
  const gateway = {
    id: gw?.id ?? 'Gateway',
    link: gatewayLink,
    value:
      gw?.status === 'Online' || gw?.status === 'Offline' ? gw.status : 'Waiting for connection',
  };
  const markers = zone ? zoneMarkers(zone) : [];
  const active =
    marker === 'gateway'
      ? { id: 'gateway' as const, label: `Gateway ${gateway.id}`, value: gateway.value }
      : (markers.find((m) => m.id === marker) ?? null);
  const online = zone?.device.status === 'Online';

  function select(zoneId: string | null, id: MarkerId | null) {
    if (zoneId && zoneId !== zone?.zoneId) live.selectZone(zoneId);
    setMarker(id);
  }

  async function logout() {
    setLeaving(true);
    await postJson('/api/prototype/logout').catch(() => undefined);
    hardNavigate('/prototype-testing/login');
  }

  return (
    <div className="proto-bg min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <BrandMark className="size-11" priority />
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-tight text-text">
                Mega-Greenhouse
              </h1>
              <p className="truncate text-sm text-text-2">Greenhouse Sensor and Actuator Testing</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-2"
              title="Judged from recent valid MQTT messages from this node."
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  online
                    ? 'proto-pulse bg-good'
                    : zone && linkOf(zone.device.status) === 'waiting'
                      ? 'bg-warning'
                      : 'bg-critical',
                )}
              />
              <span>
                {zone
                  ? `${zone.device.deviceId}: ${STATUS_TEXT[zone.device.status]}`
                  : 'No zone yet'}
                <span className="text-muted"> (via MQTT)</span>
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={logout} disabled={leaving}>
              {leaving ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <LogOut aria-hidden="true" />
              )}
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <p className="flex gap-2.5 rounded-xl border border-info-fg/20 bg-info-soft px-4 py-3 text-sm text-info-fg">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Readings and light states come from the gateway over MQTT. A node shows Online only after
          it sends valid messages, and a light shows ON or OFF only after the node confirms it.
        </p>

        <LiveSensorCards zone={zone} now={now} />

        <div className="flex flex-col gap-6">
          <Panel className="flex min-w-0 flex-col gap-3">
            <SectionTitle icon={Box} title="3D Greenhouse">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-semibold tracking-wide text-good-fg">
                  {live.state?.greenhouse.id ?? 'GREENHOUSE'} · {live.zones.length}{' '}
                  {live.zones.length === 1 ? 'zone' : 'zones'}
                </span>
                {live.zones.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-text-2">
                    <span className="hidden sm:inline">Zone</span>
                    <Select
                      aria-label="Zone shown"
                      className="h-8 w-auto max-w-44 py-0 text-xs sm:max-w-none"
                      value={zone?.zoneId ?? ''}
                      onChange={(e) => select(e.target.value, null)}
                    >
                      {live.zones.map((zn) => (
                        <option key={zn.zoneId} value={zn.zoneId}>
                          {zn.zoneId} · {zn.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
              </div>
            </SectionTitle>
            <div className="relative h-[380px] overflow-hidden rounded-xl border border-border sm:h-[500px]">
              <GreenhouseScene
                zones={live.zones.map(sceneZone)}
                gateway={gateway}
                markers={markers}
                selectedZone={zone?.zoneId ?? null}
                selected={marker}
                onSelect={select}
              />
              <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-bold tracking-wider text-white">
                {zone ? `${zone.zoneId} · ${zone.name}` : 'NO ZONES'}
              </span>
              <div className="absolute right-3 top-3 z-10">
                <LiveLightButton zone={zone} onSend={live.sendLight} />
              </div>
              {!live.zones.length && live.state && (
                <p className="pointer-events-none absolute inset-x-3 bottom-14 mx-auto max-w-sm rounded-xl bg-surface/90 p-3 text-center text-sm text-text-2 shadow backdrop-blur">
                  No zones configured. Add a zone below and the greenhouse extends with it.
                </p>
              )}
              {active && (
                <div className="proto-rise absolute left-3 top-11 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-text">{active.label}</p>
                    <button
                      type="button"
                      onClick={() => setMarker(null)}
                      aria-label="Close marker details"
                      className="-m-1 rounded p-1 text-muted hover:text-text"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <p className="tabular mt-0.5 text-xl font-semibold text-primary">
                    {active.value}
                  </p>
                  <p className="mt-1 text-xs text-text-2">{MARKER_INFO[active.id]}</p>
                  {active.id !== 'gateway' && zone && (
                    <p className="mt-1.5 text-[11px] font-medium text-text-2">
                      {zone.name} ({zone.zoneId}). A &quot;(test)&quot; value is a manual test
                      payload.
                    </p>
                  )}
                </div>
              )}
            </div>
            <LiveLightStatus zone={zone} now={now} />
            <p className="text-xs text-muted">
              Drag to rotate, scroll or pinch to zoom. Each bay is one zone with its own node,
              sensors and light; click a bay or its label to show that zone, and a fitting for its
              value.
            </p>
          </Panel>
        </div>

        <LiveStatusBar live={live.state} now={now} />

        <LiveZonesPanel live={live} now={now} />

        <footer className="pb-4 text-center text-xs text-muted">
          Kye Phel · Prototype Testing Lab · One gateway, one node per zone, connected through EMQX
          Cloud.
        </footer>
      </main>
    </div>
  );
}
