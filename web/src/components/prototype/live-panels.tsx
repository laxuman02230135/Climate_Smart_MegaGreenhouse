'use client';

import {
  CheckCircle2,
  Cpu,
  Droplets,
  Gauge,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Sun,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import type { DisplayStatus, ZoneState } from '@/lib/prototype/engine';
import { SENSOR_LABEL, type SensorKind } from '@/lib/prototype/types';
import { lightText, nextId, readingText, STATUS_TEXT } from '@/lib/prototype/zone-view';
import { cn } from '@/lib/utils';
import { ago, Panel, SectionTitle } from './shared';
import type { LiveLab, LiveState } from './use-live-lab';

const TONE = {
  good: 'bg-good-soft text-good-fg',
  warn: 'bg-warning-soft text-warning-fg',
  bad: 'bg-critical-soft text-critical-fg',
  info: 'bg-info-soft text-info-fg',
  idle: 'bg-surface-2 text-muted',
} as const;

function Pill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

const DEVICE_TONE: Record<DisplayStatus, keyof typeof TONE> = {
  Online: 'good',
  Offline: 'idle',
  Error: 'bad',
  Joining: 'warn',
  Registered: 'info',
};

export function DeviceStatusPill({ status }: { status: DisplayStatus }) {
  return <Pill tone={DEVICE_TONE[status]}>{STATUS_TEXT[status]}</Pill>;
}

/** Backend↔EMQX, gateway and last-telemetry status, kept separate on purpose. */
export function LiveStatusBar({ live, now }: { live: LiveState | null; now: number }) {
  if (!live) {
    return (
      <Panel className="flex items-center gap-2 text-sm text-text-2" aria-busy="true">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading live status…
      </Panel>
    );
  }
  const { mqtt, gateway } = live;
  const mqttTone =
    mqtt.status === 'connected' ? 'good' : mqtt.status === 'not-configured' ? 'warn' : 'bad';
  const mqttText: Record<typeof mqtt.status, string> = {
    connected: 'Connected',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
    error: 'Error',
    'not-configured': 'Not configured',
  };
  const lastTelemetry = Math.max(
    0,
    ...live.zones.flatMap((z) => Object.values(z.sensors).map((s) => s.receivedAt)),
  );
  const gwTone =
    gateway.status === 'Online' ? 'good' : gateway.status === 'Offline' ? 'bad' : 'idle';
  const pending = live.zones.filter((z) => z.light.command?.status === 'pending').length;
  const failed = live.zones.filter(
    (z) => z.light.command?.status === 'failed' || z.light.command?.status === 'timeout',
  ).length;

  return (
    <Panel className="flex flex-col gap-3">
      <SectionTitle icon={Radio} title="Live Connection (EMQX Cloud)" />
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-text-2">Backend ↔ EMQX</dt>
          <dd className="mt-0.5">
            <Pill tone={mqttTone}>{mqttText[mqtt.status]}</Pill>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-2">Gateway {gateway.id}</dt>
          <dd className="mt-0.5">
            <Pill tone={gwTone}>{gateway.status}</Pill>
            <span className="ml-2 text-xs text-muted">
              {gateway.lastSeen ? `seen ${ago(gateway.lastSeen, now)}` : 'no status received yet'}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-2">Last telemetry</dt>
          <dd className="mt-0.5 text-text">
            {lastTelemetry ? ago(lastTelemetry, now) : 'None yet'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-2">Light commands</dt>
          <dd className="mt-0.5 text-text">
            {pending} pending · {failed} failed or timed out
          </dd>
        </div>
      </dl>
      {mqtt.status === 'not-configured' && (
        <p className="rounded-lg bg-warning-soft p-2.5 text-xs text-warning-fg">
          EMQX is not configured. Set {mqtt.missing.join(', ')} in the web server environment, then
          restart. Nothing on this page is live until then.
        </p>
      )}
      {mqtt.lastError && mqtt.status !== 'connected' && (
        <p className="rounded-lg bg-critical-soft p-2.5 text-xs text-critical-fg">
          Last connection error: {mqtt.lastError}
        </p>
      )}
      <p className="text-xs text-muted">
        A connected broker does not prove the gateway is online, and an online gateway does not
        prove any node is. Each is judged from its own recent messages.
      </p>
    </Panel>
  );
}

function SensorCard({
  icon: Icon,
  title,
  accent,
  kind,
  zone,
  status,
  now,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  accent: string;
  kind: SensorKind;
  zone: ZoneState;
  status: (v: number) => { text: string; tone: keyof typeof TONE };
  now: number;
}) {
  const supported = zone.device.supportedSensors.includes(kind);
  const s = zone.sensors[kind];
  const st = s ? status(s.value) : null;
  const range =
    kind === 'temperature'
      ? { min: 0, max: 50 }
      : kind === 'soilMoisture'
        ? { min: 0, max: 100 }
        : { min: 0, max: 4095 };
  const progress = s
    ? Math.max(0.08, Math.min(0.97, (s.value - range.min) / (range.max - range.min)))
    : 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);
  const value = s ? (Number.isInteger(s.value) ? String(s.value) : s.value.toFixed(1)) : '—';
  const detail = !supported
    ? 'Not installed'
    : !s
      ? 'Waiting for data'
      : `${st!.text} · ${ago(s.receivedAt, now)}`;

  return (
    <article className="proto-gauge-card" aria-label={`${title}: ${s ? `${value} ${s.unit}` : detail}`}>
      <div className="proto-gauge-ring" aria-hidden="true">
        <svg viewBox="0 0 112 112" className="size-32 -rotate-90">
          <circle className="proto-gauge-track" cx="56" cy="56" r={radius} />
          {s && (
            <circle
              className="proto-gauge-value"
              cx="56"
              cy="56"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
            />
          )}
        </svg>
        <div className="proto-gauge-centre">
          <Icon className={cn('size-4', accent)} />
          <span className="proto-gauge-value-text">{value}</span>
          {s && <span className="proto-gauge-unit">{s.unit}</span>}
        </div>
      </div>
      <h3>{title}</h3>
      <p className={cn('proto-gauge-detail', s?.freshness === 'stale' && 'text-muted')}>
        {detail}
      </p>
    </article>
  );
}
export function LiveSensorCards({ zone, now }: { zone: ZoneState | null; now: number }) {
  return (
    <section aria-label="Sensor Readings" className="flex flex-col gap-3">
      <SectionTitle icon={Gauge} title="Sensor Readings">
        <p className="text-xs text-muted">
          {zone
            ? `${zone.name} (${zone.zoneId}) · ${zone.device.deviceId}. Values appear only when received over MQTT.`
            : 'Add a zone to see its readings.'}
        </p>
      </SectionTitle>
      {!zone ? (
        <Panel className="text-sm text-text-2">
          Add a zone below to start receiving readings for its node.
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <SensorCard
            icon={Thermometer}
            title="Temperature"
            accent="bg-critical-soft text-critical-fg"
            kind="temperature"
            zone={zone}
            now={now}
            status={(v) =>
              v > zone.settings.tempHighAbove
                ? { text: 'Above limit', tone: 'bad' }
                : { text: 'Within limit', tone: 'good' }
            }
          />
          <SensorCard
            icon={Droplets}
            title="Soil Moisture"
            accent="bg-info-soft text-info-fg"
            kind="soilMoisture"
            zone={zone}
            now={now}
            status={(v) =>
              v < zone.settings.soilDryBelow
                ? { text: 'Dry', tone: 'warn' }
                : { text: 'Adequate', tone: 'good' }
            }
          />
          <SensorCard
            icon={Sun}
            title="Light Sensor (LDR)"
            accent="bg-warning-soft text-warning-fg"
            kind="light"
            zone={zone}
            now={now}
            status={(v) =>
              v < zone.settings.lightThresholdAdc
                ? { text: 'Below threshold', tone: 'warn' }
                : { text: 'Above threshold', tone: 'info' }
            }
          />
        </div>
      )}
    </section>
  );
}

/** Small cube over the greenhouse. It shows the LAST REPORTED state, never the requested one. */
export function LiveLightButton({
  zone,
  onSend,
  compact = false,
}: {
  zone: ZoneState | null;
  onSend: (zoneId: string, action: 'ON' | 'OFF') => Promise<unknown>;
  /** Smaller variant for the zone list. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const cmd = zone?.light.command;
  const pending = busy || cmd?.status === 'pending';
  const reported = zone?.light.reportedState ?? null;
  const online = zone?.device.status === 'Online';
  const disabled = !zone || !zone.light.supported || !online || pending;
  const title = !zone
    ? 'Add a zone first.'
    : !zone.light.supported
      ? 'This node has no light actuator registered.'
      : !online
        ? `${zone.device.deviceId}: ${STATUS_TEXT[zone.device.status]}. It must be online to be commanded.`
        : `Request light ${reported === 'ON' ? 'OFF' : 'ON'} for ${zone.zoneId}`;

  async function click() {
    if (!zone) return;
    const action = reported === 'ON' ? 'OFF' : 'ON';
    setBusy(true);
    try {
      await onSend(zone.zoneId, action);
      toast.info(`Light ${action} requested for ${zone.zoneId}`, {
        description: 'Waiting for the node to acknowledge. This is not yet confirmed.',
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={`Request light for ${zone?.zoneId ?? 'zone'}`}
      title={title}
      disabled={disabled}
      onClick={click}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-xs font-bold backdrop-blur transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        compact ? 'size-12 text-[10px] [&_svg]:size-4' : 'size-16 shadow-lg',
        reported === 'ON'
          ? 'proto-bulb-on border-[#d99a00] bg-[#fff4d1] text-[#8a6100]'
          : 'border-border-strong bg-surface/90 text-text-2',
      )}
    >
      {pending ? (
        <Loader2 className={cn('animate-spin', compact ? 'size-4' : 'size-6')} aria-hidden="true" />
      ) : (
        <Lightbulb
          className={compact ? 'size-4' : 'size-6'}
          fill={reported === 'ON' ? '#ffd65a' : 'none'}
          aria-hidden="true"
        />
      )}
      <span>{reported ?? (compact ? '—' : '?')}</span>
    </button>
  );
}

/** Spells out requested vs pending vs acknowledged vs reported for the selected zone. */
export function LiveLightStatus({ zone, now }: { zone: ZoneState | null; now: number }) {
  if (!zone) return null;
  const { light } = zone;
  const c = light.command;
  const cmdText = !c
    ? 'No command sent'
    : c.status === 'pending'
      ? `Requested ${c.requestedAction}, waiting for acknowledgement (attempt ${c.attempts})`
      : c.status === 'acknowledged'
        ? `Requested ${c.requestedAction}, acknowledged ${ago(c.updatedAt, now)}`
        : c.status === 'timeout'
          ? `Requested ${c.requestedAction}, timed out with no acknowledgement`
          : `Requested ${c.requestedAction}, failed: ${c.error ?? 'device error'}`;
  const tone: keyof typeof TONE =
    c?.status === 'failed' || c?.status === 'timeout'
      ? 'bad'
      : c?.status === 'pending'
        ? 'warn'
        : 'idle';
  const reportedText = !light.supported
    ? 'No light actuator on this node'
    : light.reportedState
      ? `Last reported state: ${light.reportedState}${light.reportedSource === 'test' ? ' (test data)' : ''}, ${ago(light.reportedAt, now)}`
      : zone.device.status === 'Online'
        ? 'Physical state unknown: the node has not reported it yet'
        : `Physical state unavailable: ${STATUS_TEXT[zone.device.status].toLowerCase()}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status" aria-live="polite">
      <Pill tone={tone}>{cmdText}</Pill>
      <span className="text-text-2">{reportedText}</span>
      <span className="text-muted">
        An MQTT publish does not prove the relay switched; only an acknowledgement does.
      </span>
    </div>
  );
}

// ---- zone management ---------------------------------------------------------------------

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const NEW_DEVICE = '__new__';

function AddZoneDialog({ live, onClose }: { live: LiveLab; onClose: () => void }) {
  const unassigned = live.state?.unassignedDevices ?? [];
  const zones = live.state?.zones ?? [];
  const [zoneId, setZoneId] = useState(() =>
    nextId(
      'ZONE',
      zones.map((z) => z.zoneId),
      2,
    ),
  );
  const [zoneName, setZoneName] = useState('');
  const [pick, setPick] = useState(unassigned[0]?.deviceId ?? NEW_DEVICE);
  const [newId, setNewId] = useState(() =>
    nextId(
      'NODE',
      [...zones.map((z) => z.device.deviceId), ...unassigned.map((d) => d.deviceId)],
      3,
    ),
  );
  const [sensors, setSensors] = useState<SensorKind[]>(['temperature', 'soilMoisture', 'light']);
  const [light, setLight] = useState(true);
  const [threshold, setThreshold] = useState('500');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await live.addZone({
        zoneId,
        zoneName,
        deviceId: pick === NEW_DEVICE ? newId : pick,
        sensors,
        light,
        settings: { lightThresholdAdc: Number(threshold) },
      });
      toast.success(`Zone ${zoneId.toUpperCase()} added to the greenhouse`, {
        description: 'Waiting for connection. The node shows Online once it sends a valid message.',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the zone');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel="Close" className="max-w-xl">
        <DialogTitle>Add zone and node to {live.state?.greenhouse.id}</DialogTitle>
        <DialogDescription>
          The greenhouse gains a bay for this zone with its own node, sensors, thresholds and light.
          The node connects once its firmware reaches the gateway.
        </DialogDescription>
        <form onSubmit={submit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="zone-id" label="Zone ID *">
            <Input
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              placeholder="ZONE-02"
              spellCheck={false}
              maxLength={32}
            />
          </Field>
          <Field id="zone-name" label="Zone name *">
            <Input
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="Tomato bed"
              maxLength={60}
            />
          </Field>
          <Field id="zone-device" label="Node *">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              {unassigned.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.deviceId} (registered, unassigned)
                </option>
              ))}
              <option value={NEW_DEVICE}>Register a new node…</option>
            </Select>
          </Field>
          {pick === NEW_DEVICE && (
            <Field id="zone-new-device" label="New node ID *">
              <Input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="NODE-002"
                spellCheck={false}
                maxLength={32}
              />
            </Field>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-text">Sensors on this node</legend>
            {(Object.keys(SENSOR_LABEL) as SensorKind[]).map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={sensors.includes(s)}
                  onChange={() => setSensors(toggle(sensors, s))}
                />
                {SENSOR_LABEL[s]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={light}
                onChange={() => setLight(!light)}
              />
              Light actuator (relay)
            </label>
            <Field
              id="zone-threshold"
              label="Light threshold (ADC)"
              hint="Used only if real automation is enabled."
            >
              <Input
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
          </div>
          {error && (
            <p role="alert" className="text-sm text-critical-fg sm:col-span-2">
              {error}
            </p>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Add zone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  zone,
  live,
  onClose,
}: {
  zone: ZoneState;
  live: LiveLab;
  onClose: () => void;
}) {
  const s = zone.settings;
  const [light, setLight] = useState(String(s.lightThresholdAdc));
  const [soil, setSoil] = useState(String(s.soilDryBelow));
  const [temp, setTemp] = useState(String(s.tempHighAbove));
  const [auto, setAuto] = useState(s.realAutomation);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await live.saveSettings(zone.zoneId, {
        lightThresholdAdc: Number(light),
        soilDryBelow: Number(soil),
        tempHighAbove: Number(temp),
        realAutomation: auto,
      });
      toast.success(`Settings saved for ${zone.zoneId}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel="Close">
        <DialogTitle>
          Settings for {zone.name} ({zone.zoneId})
        </DialogTitle>
        <DialogDescription>
          Each zone has its own thresholds and automation switch.
        </DialogDescription>
        <form onSubmit={submit} noValidate className="mt-4 grid gap-4">
          <Field id="set-light" label="Light threshold (ADC, 0–4095)">
            <Input inputMode="numeric" value={light} onChange={(e) => setLight(e.target.value)} />
          </Field>
          <Field id="set-soil" label="Soil dry below (%)">
            <Input inputMode="decimal" value={soil} onChange={(e) => setSoil(e.target.value)} />
          </Field>
          <Field id="set-temp" label="Temperature high above (°C)">
            <Input inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning-fg">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={auto}
              onChange={() => setAuto(!auto)}
            />
            <span>
              <strong>Enable real light automation for this zone.</strong> When on, readings from
              the physical node (never test data) can send light ON/OFF commands. Off by default.
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-critical-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save settings</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-2">
      {children}
    </span>
  );
}

export function LiveZonesPanel({ live, now }: { live: LiveLab; now: number }) {
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ZoneState | null>(null);
  const [removeNode, setRemoveNode] = useState(false);
  const state = live.state;
  const editZone = live.zones.find((z) => z.zoneId === editing) ?? null;

  async function action(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  }

  return (
    <Panel className="flex flex-col gap-4">
      <SectionTitle icon={Cpu} title={`Zones in ${state?.greenhouse.id ?? 'greenhouse'}`}>
        <Button size="sm" onClick={() => setAdding(Date.now())}>
          <Plus aria-hidden="true" />
          Add Zone
        </Button>
      </SectionTitle>

      {live.error && (
        <p role="alert" className="rounded-lg bg-critical-soft p-2.5 text-sm text-critical-fg">
          {live.error}
        </p>
      )}

      {live.zones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-8 text-center">
          <p className="font-semibold text-text">No zones yet</p>
          <p className="mt-1 text-sm text-text-2">
            Add ZONE-01 with NODE-001 to start. Each zone you add extends the greenhouse with its
            own bay, node, sensors and light.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {live.zones.map((z) => {
            const active = z.zoneId === live.selected?.zoneId;
            const never = z.device.lastSeen === null;
            return (
              <li
                key={z.zoneId}
                className={cn(
                  'rounded-xl border p-3 sm:p-4',
                  active ? 'border-primary bg-primary-soft/50' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-text">{z.name}</span>
                      <code className="rounded bg-surface-2 px-1.5 text-xs text-text-2">
                        {z.zoneId}
                      </code>
                      <code className="rounded bg-surface-2 px-1.5 text-xs text-text-2">
                        {z.device.deviceId}
                      </code>
                      <DeviceStatusPill status={z.device.status} />
                      {z.device.lastSource === 'test' && <Pill tone="warn">TEST DATA</Pill>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {never
                        ? 'Waiting for connection: no message received from this node yet'
                        : `Last seen ${ago(z.device.lastSeen, now)}`}
                      {z.device.error ? ` · Error: ${z.device.error}` : ''}
                      {z.settings.realAutomation ? ' · Real light automation ON' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {active ? (
                      <span className="inline-flex h-8 items-center gap-1 px-2 text-xs font-semibold text-primary">
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Viewing
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => live.selectZone(z.zoneId)}>
                        Show zone
                      </Button>
                    )}
                    {never && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          action(
                            () => live.commission(z.device.deviceId),
                            'Waiting for JOIN_REQUEST',
                          )
                        }
                      >
                        Join
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Settings for ${z.name}`}
                      onClick={() => setEditing(z.zoneId)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${z.name}`}
                      className="hover:text-critical-fg"
                      onClick={() => {
                        setRemoveNode(false);
                        setRemoving(z);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                    {z.device.supportedSensors.map((s) => (
                      <div key={s} className="min-w-0">
                        <dt className="text-muted">{SENSOR_LABEL[s]}</dt>
                        <dd className="tabular truncate font-medium text-text">
                          {readingText(z, s)}
                        </dd>
                      </div>
                    ))}
                    {z.light.supported && (
                      <div className="min-w-0">
                        <dt className="text-muted">Light</dt>
                        <dd className="truncate font-medium text-text" title={lightText(z)}>
                          {lightText(z)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {z.light.supported && (
                    <LiveLightButton zone={z} onSend={live.sendLight} compact />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {z.device.supportedSensors.includes('light') && (
                    <Tag>Light threshold {z.settings.lightThresholdAdc} ADC</Tag>
                  )}
                  {z.device.supportedSensors.includes('soilMoisture') && (
                    <Tag>Dry below {z.settings.soilDryBelow} %</Tag>
                  )}
                  {z.device.supportedSensors.includes('temperature') && (
                    <Tag>Hot above {z.settings.tempHighAbove} °C</Tag>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {state && state.unassignedDevices.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text">Registered, unassigned nodes</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {state.unassignedDevices.map((d) => (
              <li
                key={d.deviceId}
                className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
              >
                <code>{d.deviceId}</code>
                <button
                  type="button"
                  aria-label={`Delete ${d.deviceId}`}
                  className="text-muted hover:text-critical-fg"
                  onClick={() =>
                    action(() => live.removeDevice(d.deviceId), `Removed ${d.deviceId}`)
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="rounded-xl border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-text">
          Recent messages and events ({state?.events.length ?? 0})
        </summary>
        <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
          {(state?.events ?? []).map((e, i) => (
            <li
              key={`${e.at}-${i}`}
              className={e.level === 'warn' ? 'text-warning-fg' : 'text-text-2'}
            >
              <span className="text-muted">{new Date(e.at).toLocaleTimeString()}</span> {e.text}
            </li>
          ))}
          {!state?.events.length && <li className="text-muted">Nothing received yet.</li>}
        </ul>
      </details>

      {adding && <AddZoneDialog key={adding} live={live} onClose={() => setAdding(null)} />}
      {editZone && <SettingsDialog zone={editZone} live={live} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'zone'}?`}
        description={`Removes ${removing?.zoneId ?? ''} and its bay from the greenhouse. No hardware is affected.`}
        confirmLabel={removeNode ? 'Remove zone and node' : 'Remove zone'}
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={() => {
          const z = removing;
          if (z)
            void action(
              async () => {
                await live.removeZone(z.zoneId);
                if (removeNode) await live.removeDevice(z.device.deviceId);
              },
              removeNode ? `Removed ${z.zoneId} and ${z.device.deviceId}` : `Removed ${z.zoneId}`,
            );
          setRemoving(null);
        }}
      >
        <label className="mt-3 flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--primary)]"
            checked={removeNode}
            onChange={() => setRemoveNode(!removeNode)}
          />
          <span>
            Also delete node {removing?.device.deviceId}. Leave unticked to keep it registered so it
            can be assigned to another zone.
          </span>
        </label>
      </ConfirmDialog>
    </Panel>
  );
}
