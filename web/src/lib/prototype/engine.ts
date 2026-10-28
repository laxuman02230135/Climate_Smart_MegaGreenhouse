import { z } from 'zod';
import {
  ackSchema,
  deviceStatusSchema,
  deviceTopic,
  gatewayStatusSchema,
  ID_PATTERN,
  parseJson,
  parseTopic,
  SENSOR_LIMITS,
  telemetrySchema,
  type CommandMessage,
  type JoinAcceptedMessage,
  type SensorKey,
} from './protocol';
import type { SensorKind } from './types';

/**
 * Server-side state machine for the live (MQTT) side of the Prototype Testing Lab: one
 * greenhouse, one gateway, zones that each own one device, sensor readings, a light command
 * lifecycle and connection status. It has no I/O of its own (the MQTT client, clock and storage
 * are injected), so it can be tested without a broker.
 *
 * Honesty rules baked in: a device is Online only after a valid message from it, a light state
 * is "reported" only after an ACK or reported actuator state, and messages flagged
 * `source: "test"` are labelled as test data and never trigger real automation.
 */

export class EngineError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const SENSOR_KEY_OF: Record<SensorKind, SensorKey> = {
  temperature: 'temperature',
  soilMoisture: 'soilMoisture',
  light: 'lightIntensity',
};
const KIND_OF_KEY = Object.fromEntries(
  Object.entries(SENSOR_KEY_OF).map(([k, v]) => [v, k]),
) as Record<SensorKey, SensorKind>;

export type RegistrationStatus = 'Registered' | 'Joining';
export type DisplayStatus = 'Registered' | 'Joining' | 'Online' | 'Offline' | 'Error';
export type LightState = 'ON' | 'OFF';
export type CommandStatus = 'pending' | 'acknowledged' | 'failed' | 'timeout';
export type DataSource = 'live' | 'test';

export interface Device {
  deviceId: string;
  deviceName: string;
  greenhouseId: string;
  zoneId: string | null;
  gatewayId: string;
  deviceType: 'lora-node';
  supportedSensors: SensorKind[];
  supportedActuators: 'light'[];
  registrationStatus: RegistrationStatus;
  joinStartedAt: number | null;
  createdAt: number;
}

export interface ZoneSettings {
  /** Light below this ADC value asks for the light ON (real automation only). */
  lightThresholdAdc: number;
  /** Soil moisture below this % is labelled dry. */
  soilDryBelow: number;
  /** Temperature above this °C is labelled hot. */
  tempHighAbove: number;
  /** Explicit opt-in. Off by default; only device-sourced (not test) telemetry can trigger it. */
  realAutomation: boolean;
}

export interface Zone {
  zoneId: string;
  name: string;
  deviceId: string;
  settings: ZoneSettings;
}

export interface Registry {
  devices: Device[];
  zones: Zone[];
}

export interface LightCommand {
  commandId: string;
  requestedAction: LightState;
  status: CommandStatus;
  attempts: number;
  sentAt: number;
  lastSentAt: number;
  updatedAt: number;
  error?: string;
  auto: boolean;
}

interface SensorSample {
  value: number;
  unit: string;
  receivedAt: number;
  deviceTimestamp: string;
  source: DataSource;
}

interface DeviceRuntime {
  lastSeen: number | null;
  lastSource: DataSource | null;
  error: string | null;
  sensors: Partial<Record<SensorKind, SensorSample>>;
  reportedLight: LightState | null;
  reportedLightAt: number | null;
  reportedLightSource: DataSource | null;
  command: LightCommand | null;
  seenIds: string[];
  lastAutoAt: number;
}

export interface EngineConfig {
  greenhouseId: string;
  greenhouseName: string;
  gatewayId: string;
  deviceOfflineMs: number;
  gatewayOfflineMs: number;
  staleMs: number;
  attemptTimeoutMs: number;
  maxAttempts: number;
  /** Minimum gap between publishes, so the single gateway radio is not asked to overlap sends. */
  minPublishGapMs: number;
  joinWindowMs: number;
  autoCooldownMs: number;
  /** Zones the one gateway serves. Each zone owns one node, so this also caps the nodes. */
  maxZones: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  greenhouseId: 'GREENHOUSE-01',
  greenhouseName: 'Greenhouse 01',
  gatewayId: 'GATEWAY-01',
  deviceOfflineMs: 60_000,
  gatewayOfflineMs: 90_000,
  staleMs: 120_000,
  attemptTimeoutMs: 5_000,
  maxAttempts: 2,
  minPublishGapMs: 400,
  joinWindowMs: 300_000,
  autoCooldownMs: 30_000,
  maxZones: 8,
};

export const DEFAULT_SETTINGS: ZoneSettings = {
  lightThresholdAdc: 500,
  soilDryBelow: 35,
  tempHighAbove: 30,
  realAutomation: false,
};

/** ADC band above the threshold before an automated light is switched off again. */
const AUTO_HYSTERESIS = 100;
const MAX_EVENTS = 40;
const MAX_SEEN_IDS = 100;

export type Publish = (topic: string, payload: string) => void;

export interface EngineDeps {
  publish: Publish;
  now?: () => number;
  newCommandId?: () => string;
  /** Called after the registry changes so the host can save it. */
  onRegistryChange?: (registry: Registry) => void;
}

export interface EngineEvent {
  at: number;
  level: 'info' | 'warn';
  text: string;
}

const idSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(ID_PATTERN, 'Use 2–32 letters, numbers, hyphens or underscores.'));
const sensorKinds = z.array(z.enum(['temperature', 'soilMoisture', 'light'])).max(3);

export const settingsSchema = z.object({
  lightThresholdAdc: z.number().int().min(0).max(4095),
  soilDryBelow: z.number().min(0).max(100),
  tempHighAbove: z.number().min(-40).max(100),
  realAutomation: z.boolean(),
});

export const addZoneSchema = z.object({
  zoneId: idSchema,
  zoneName: z.string().trim().min(1, 'Enter a zone name.').max(60),
  deviceId: idSchema,
  deviceName: z.string().trim().max(60).optional(),
  sensors: sensorKinds,
  light: z.boolean(),
  settings: settingsSchema.partial().optional(),
});
export type AddZoneInput = z.input<typeof addZoneSchema>;

function fail(status: number, code: string, message: string): never {
  throw new EngineError(status, code, message);
}

function parseOrFail<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) fail(400, 'VALIDATION_FAILED', r.error.issues[0]?.message ?? 'Invalid input');
  return r.data;
}

export class PrototypeEngine {
  readonly config: EngineConfig;
  private readonly deps: Required<Pick<EngineDeps, 'publish' | 'now'>> & EngineDeps;
  private devices = new Map<string, Device>();
  private zones = new Map<string, Zone>();
  private runtime = new Map<string, DeviceRuntime>();
  private gateway = {
    lastSeen: null as number | null,
    reported: null as 'online' | 'offline' | null,
    source: null as DataSource | null,
  };
  private events: EngineEvent[] = [];
  private queue: { topic: string; payload: string }[] = [];
  private lastPublishAt = 0;
  private counter = 0;

  constructor(deps: EngineDeps, config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = { ...deps, publish: deps.publish, now: deps.now ?? Date.now };
  }

  // ---- registry ---------------------------------------------------------------------------

  exportRegistry(): Registry {
    return {
      devices: [...this.devices.values()].map((d) => ({ ...d })),
      zones: [...this.zones.values()].map((z) => ({ ...z, settings: { ...z.settings } })),
    };
  }

  importRegistry(reg: Registry): void {
    this.devices.clear();
    this.zones.clear();
    for (const d of reg.devices) this.devices.set(d.deviceId, { ...d });
    for (const z of reg.zones) {
      if (this.devices.has(z.deviceId))
        this.zones.set(z.zoneId, { ...z, settings: { ...DEFAULT_SETTINGS, ...z.settings } });
    }
  }

  private changed(): void {
    this.deps.onRegistryChange?.(this.exportRegistry());
  }

  private rt(deviceId: string): DeviceRuntime {
    let r = this.runtime.get(deviceId);
    if (!r) {
      r = {
        lastSeen: null,
        lastSource: null,
        error: null,
        sensors: {},
        reportedLight: null,
        reportedLightAt: null,
        reportedLightSource: null,
        command: null,
        seenIds: [],
        lastAutoAt: 0,
      };
      this.runtime.set(deviceId, r);
    }
    return r;
  }

  /** Adds a zone to the greenhouse and assigns (or first registers) its device. */
  addZone(input: unknown): Zone {
    const v = parseOrFail(addZoneSchema, input);
    if (this.zones.has(v.zoneId)) fail(409, 'ZONE_EXISTS', `Zone ${v.zoneId} already exists.`);
    if (this.zones.size >= this.config.maxZones)
      fail(409, 'ZONE_LIMIT', `The greenhouse already has ${this.config.maxZones} zones.`);
    const existing = this.devices.get(v.deviceId);
    if (existing?.zoneId)
      fail(409, 'DEVICE_ASSIGNED', `${v.deviceId} is already assigned to ${existing.zoneId}.`);
    const sensors = [...new Set(v.sensors)];
    const actuators: 'light'[] = v.light ? ['light'] : [];
    if (existing) {
      existing.zoneId = v.zoneId;
      existing.supportedSensors = sensors;
      existing.supportedActuators = actuators;
      if (v.deviceName) existing.deviceName = v.deviceName;
    } else {
      this.devices.set(v.deviceId, {
        deviceId: v.deviceId,
        deviceName: v.deviceName || v.deviceId,
        greenhouseId: this.config.greenhouseId,
        zoneId: v.zoneId,
        gatewayId: this.config.gatewayId,
        deviceType: 'lora-node',
        supportedSensors: sensors,
        supportedActuators: actuators,
        registrationStatus: 'Registered',
        joinStartedAt: null,
        createdAt: this.deps.now(),
      });
    }
    const zone: Zone = {
      zoneId: v.zoneId,
      name: v.zoneName,
      deviceId: v.deviceId,
      settings: { ...DEFAULT_SETTINGS, ...v.settings },
    };
    this.zones.set(zone.zoneId, zone);
    this.log(
      'info',
      `Zone ${zone.zoneId} added with ${v.deviceId}. Waiting for its first message.`,
    );
    this.changed();
    return zone;
  }

  /** Removes the zone. Its device stays registered but unassigned. */
  removeZone(zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (!zone) fail(404, 'ZONE_NOT_FOUND', `Zone ${zoneId} does not exist.`);
    const device = this.devices.get(zone.deviceId);
    if (device) device.zoneId = null;
    this.zones.delete(zoneId);
    const r = this.runtime.get(zone.deviceId);
    if (r) r.command = null;
    this.log('info', `Zone ${zoneId} removed. ${zone.deviceId} is unassigned.`);
    this.changed();
  }

  removeDevice(deviceId: string): void {
    const d = this.devices.get(deviceId);
    if (!d) fail(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} does not exist.`);
    if (d.zoneId) fail(409, 'DEVICE_ASSIGNED', `Remove zone ${d.zoneId} first.`);
    this.devices.delete(deviceId);
    this.runtime.delete(deviceId);
    this.changed();
  }

  updateSettings(zoneId: string, input: unknown): Zone {
    const zone = this.zones.get(zoneId);
    if (!zone) fail(404, 'ZONE_NOT_FOUND', `Zone ${zoneId} does not exist.`);
    zone.settings = {
      ...zone.settings,
      ...parseOrFail(settingsSchema.partial(), input),
    };
    this.log(
      'info',
      `Zone ${zoneId} settings saved. Real light automation is ${zone.settings.realAutomation ? 'ON' : 'off'}.`,
    );
    this.changed();
    return zone;
  }

  /** Starts a commissioning window: the app now waits for this device's JOIN_REQUEST. */
  commission(deviceId: string): Device {
    const d = this.devices.get(deviceId);
    if (!d) fail(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} does not exist.`);
    if (!d.zoneId) fail(409, 'DEVICE_UNASSIGNED', `Assign ${deviceId} to a zone first.`);
    d.registrationStatus = 'Joining';
    d.joinStartedAt = this.deps.now();
    this.log(
      'info',
      `${deviceId} is waiting to join. It must send a JOIN_REQUEST via the gateway.`,
    );
    this.changed();
    return d;
  }

  // ---- inbound messages -------------------------------------------------------------------

  handleMessage(topic: string, raw: string | Uint8Array): void {
    const now = this.deps.now();
    const parsed = parseTopic(topic);
    if (!parsed) return this.log('warn', `Ignored a message on an unknown topic.`);
    const json = parseJson(raw);
    if (json === null || typeof json !== 'object')
      return this.log('warn', `Ignored a malformed (non-JSON) message on ${topic}.`);

    if (parsed.kind === 'gatewayStatus') return this.onGateway(parsed.gatewayId, json, now);
    const { zoneId, deviceId } = parsed;
    if (parsed.kind === 'telemetry') return this.onTelemetry(zoneId, deviceId, json, now);
    if (parsed.kind === 'status') return this.onDeviceStatus(zoneId, deviceId, json, now);
    return this.onAck(zoneId, deviceId, json, now);
  }

  private onGateway(topicGateway: string, json: unknown, now: number): void {
    const r = gatewayStatusSchema.safeParse(json);
    if (!r.success) return this.log('warn', 'Rejected an invalid gateway status message.');
    if (r.data.gatewayId !== topicGateway || topicGateway !== this.config.gatewayId)
      return this.log('warn', `Ignored status from unknown gateway ${topicGateway}.`);
    this.gateway.lastSeen = now;
    this.gateway.reported = r.data.status;
    this.gateway.source = r.data.source === 'test' ? 'test' : 'live';
  }

  /** Checks topic/payload IDs match and the device is registered and assigned to that zone. */
  private resolve(
    kind: string,
    zoneId: string,
    deviceId: string,
    p: { zoneId: string; deviceId: string; gatewayId?: string | undefined },
  ): Device | null {
    if (p.zoneId !== zoneId || p.deviceId !== deviceId) {
      this.log('warn', `Rejected ${kind}: payload IDs do not match the topic (${deviceId}).`);
      return null;
    }
    if (p.gatewayId && p.gatewayId !== this.config.gatewayId) {
      this.log('warn', `Rejected ${kind} from ${deviceId}: unknown gateway ${p.gatewayId}.`);
      return null;
    }
    const d = this.devices.get(deviceId);
    if (!d) {
      this.log('warn', `Rejected ${kind}: ${deviceId} is not registered.`);
      return null;
    }
    if (d.zoneId !== zoneId) {
      this.log(
        'warn',
        `Rejected ${kind}: ${deviceId} is ${d.zoneId ? `assigned to ${d.zoneId}, not ${zoneId}` : 'not assigned to a zone'}.`,
      );
      return null;
    }
    return d;
  }

  private duplicate(r: DeviceRuntime, messageId: string | undefined): boolean {
    if (!messageId) return false;
    if (r.seenIds.includes(messageId)) return true;
    r.seenIds.push(messageId);
    if (r.seenIds.length > MAX_SEEN_IDS) r.seenIds.shift();
    return false;
  }

  private touch(r: DeviceRuntime, now: number, source: DataSource): void {
    r.lastSeen = now;
    r.lastSource = source;
    r.error = null;
  }

  private onTelemetry(zoneId: string, deviceId: string, json: unknown, now: number): void {
    const parsed = telemetrySchema.safeParse(json);
    if (!parsed.success) return this.log('warn', `Rejected invalid telemetry for ${deviceId}.`);
    const m = parsed.data;
    const device = this.resolve('telemetry', zoneId, deviceId, m);
    if (!device) return;
    const r = this.rt(deviceId);
    if (this.duplicate(r, m.messageId)) return;
    const source: DataSource = m.source === 'test' ? 'test' : 'live';

    let accepted = 0;
    for (const [key, s] of Object.entries(m.sensors)) {
      const known = Object.hasOwn(SENSOR_LIMITS, key);
      const limits = SENSOR_LIMITS[key as SensorKey];
      const kind = known ? KIND_OF_KEY[key as SensorKey] : undefined;
      if (!kind) {
        this.log('warn', `${deviceId}: ignored unknown sensor "${key}".`);
      } else if (!device.supportedSensors.includes(kind)) {
        this.log('warn', `${deviceId}: ignored ${key}, which is not registered for this device.`);
      } else if (s.value < limits.min || s.value > limits.max) {
        this.log('warn', `${deviceId}: rejected out-of-range ${key} value.`);
      } else {
        r.sensors[kind] = {
          value: s.value,
          unit: s.unit ?? limits.unit,
          receivedAt: now,
          deviceTimestamp: m.timestamp,
          source,
        };
        accepted++;
      }
    }
    const light = m.actuators?.light?.state;
    if (light && device.supportedActuators.includes('light'))
      this.setReported(r, light, now, source);
    if (!accepted && !light) return;
    this.touch(r, now, source);
    this.markJoined(device);
    this.autoLight(device, r, now, source);
  }

  private onDeviceStatus(zoneId: string, deviceId: string, json: unknown, now: number): void {
    const parsed = deviceStatusSchema.safeParse(json);
    if (!parsed.success)
      return this.log('warn', `Rejected an invalid status message for ${deviceId}.`);
    const m = parsed.data;
    const device = this.resolve(m.messageType, zoneId, deviceId, m);
    if (!device) return;
    const r = this.rt(deviceId);
    if (this.duplicate(r, m.messageId)) return;
    const source: DataSource = m.source === 'test' ? 'test' : 'live';
    this.touch(r, now, source);

    const light = m.actuators?.light?.state;
    if (light && device.supportedActuators.includes('light'))
      this.setReported(r, light, now, source);
    if (m.messageType === 'ERROR') {
      r.error = m.error?.message ?? 'Device reported an error';
      this.log('warn', `${deviceId} reported an error: ${r.error}`);
    } else if (m.messageType === 'JOIN_REQUEST') {
      this.markJoined(device);
      this.log('info', `${deviceId} sent a JOIN_REQUEST and was accepted (it is registered).`);
      const accepted: JoinAcceptedMessage = {
        messageType: 'JOIN_ACCEPTED',
        deviceId,
        zoneId,
        gatewayId: this.config.gatewayId,
        timestamp: new Date(now).toISOString(),
      };
      this.enqueue(deviceTopic(zoneId, deviceId, 'commands'), accepted);
      this.flush(now);
    } else {
      this.markJoined(device);
    }
  }

  private markJoined(d: Device): void {
    d.registrationStatus = 'Registered';
    d.joinStartedAt = null;
  }

  private setReported(r: DeviceRuntime, state: LightState, now: number, source: DataSource): void {
    r.reportedLight = state;
    r.reportedLightAt = now;
    r.reportedLightSource = source;
  }

  private onAck(zoneId: string, deviceId: string, json: unknown, now: number): void {
    const parsed = ackSchema.safeParse(json);
    if (!parsed.success) return this.log('warn', `Rejected an invalid ACK for ${deviceId}.`);
    const m = parsed.data;
    const device = this.resolve('ACK', zoneId, deviceId, m);
    if (!device) return;
    const r = this.rt(deviceId);
    if (this.duplicate(r, m.messageId)) return;
    const c = r.command;
    if (!c || c.commandId !== m.commandId) {
      return this.log('warn', `${deviceId}: ignored an ACK for unknown command ${m.commandId}.`);
    }
    const source: DataSource = m.source === 'test' ? 'test' : 'live';
    this.touch(r, now, source);
    c.updatedAt = now;
    if (m.status === 'success') {
      c.status = 'acknowledged';
      if (m.reportedState) this.setReported(r, m.reportedState, now, source);
      this.log('info', `${deviceId} acknowledged light ${c.requestedAction}.`);
    } else {
      c.status = 'failed';
      c.error = m.error ?? 'The device reported that the command failed';
      this.log('warn', `${deviceId}: light ${c.requestedAction} failed: ${c.error}`);
    }
  }

  // ---- commands ---------------------------------------------------------------------------

  /** Requests the zone's light. The result is only a request until an ACK arrives. */
  sendLight(zoneId: string, action: LightState, auto = false): LightCommand {
    const now = this.deps.now();
    const zone = this.zones.get(zoneId);
    if (!zone) fail(404, 'ZONE_NOT_FOUND', `Zone ${zoneId} does not exist.`);
    const device = this.devices.get(zone.deviceId)!;
    if (!device.supportedActuators.includes('light'))
      fail(409, 'NO_LIGHT', `${device.deviceId} has no light actuator registered.`);
    if (this.gatewayStatus(now) === 'Offline')
      fail(409, 'GATEWAY_OFFLINE', 'The gateway is offline, so the command cannot be delivered.');
    const status = this.displayStatus(device, now);
    if (status !== 'Online')
      fail(
        409,
        'DEVICE_NOT_ONLINE',
        `${device.deviceId} is ${status}. It must be online (recent valid messages) before it can be commanded.`,
      );
    const r = this.rt(device.deviceId);
    if (r.command?.status === 'pending')
      fail(
        409,
        'COMMAND_PENDING',
        'The previous light command is still waiting for an acknowledgement.',
      );
    const commandId = this.deps.newCommandId?.() ?? `cmd-${now.toString(36)}-${++this.counter}`;
    r.command = {
      commandId,
      requestedAction: action,
      status: 'pending',
      attempts: 0,
      sentAt: now,
      lastSentAt: now,
      updatedAt: now,
      auto,
    };
    this.sendCommand(zone, r.command, now);
    this.log(
      'info',
      `${auto ? 'Automation requested' : 'Requested'} light ${action} for ${zoneId}.`,
    );
    return r.command;
  }

  private sendCommand(zone: Zone, c: LightCommand, now: number): void {
    const msg: CommandMessage = {
      messageType: 'COMMAND',
      commandId: c.commandId,
      deviceId: zone.deviceId,
      zoneId: zone.zoneId,
      gatewayId: this.config.gatewayId,
      actuator: 'light',
      action: c.requestedAction,
      timestamp: new Date(now).toISOString(),
    };
    c.attempts++;
    c.lastSentAt = now;
    this.enqueue(deviceTopic(zone.zoneId, zone.deviceId, 'commands'), msg);
    this.flush(now);
  }

  private autoLight(device: Device, r: DeviceRuntime, now: number, source: DataSource): void {
    const zone = device.zoneId ? this.zones.get(device.zoneId) : undefined;
    if (!zone || !zone.settings.realAutomation || source === 'test') return;
    if (!device.supportedActuators.includes('light')) return;
    const light = r.sensors.light;
    if (!light || light.receivedAt !== now) return;
    if (r.command?.status === 'pending' || now - r.lastAutoAt < this.config.autoCooldownMs) return;
    const t = zone.settings.lightThresholdAdc;
    let want: LightState | null = null;
    if (light.value < t && r.reportedLight !== 'ON') want = 'ON';
    else if (light.value > t + AUTO_HYSTERESIS && r.reportedLight === 'ON') want = 'OFF';
    if (!want) return;
    r.lastAutoAt = now;
    try {
      this.sendLight(zone.zoneId, want, true);
    } catch (e) {
      if (e instanceof EngineError) this.log('warn', `Automation could not send: ${e.message}`);
    }
  }

  // ---- time -------------------------------------------------------------------------------

  /** Call about every 250 ms: retries/timeouts, publish queue, commissioning window. */
  tick(): void {
    const now = this.deps.now();
    for (const zone of this.zones.values()) {
      const r = this.runtime.get(zone.deviceId);
      const c = r?.command;
      if (c?.status === 'pending' && now - c.lastSentAt >= this.config.attemptTimeoutMs) {
        if (c.attempts < this.config.maxAttempts) {
          this.log(
            'warn',
            `No ACK from ${zone.deviceId} yet. Retrying light ${c.requestedAction}.`,
          );
          this.sendCommand(zone, c, now);
        } else {
          c.status = 'timeout';
          c.updatedAt = now;
          c.error = 'No acknowledgement received';
          this.log('warn', `Light ${c.requestedAction} for ${zone.zoneId} timed out with no ACK.`);
        }
      }
    }
    for (const d of this.devices.values()) {
      if (
        d.registrationStatus === 'Joining' &&
        d.joinStartedAt !== null &&
        now - d.joinStartedAt > this.config.joinWindowMs
      ) {
        d.registrationStatus = 'Registered';
        d.joinStartedAt = null;
        this.log('warn', `${d.deviceId} did not join within the commissioning window.`);
        this.changed();
      }
    }
    this.flush(now);
  }

  private enqueue(topic: string, message: object): void {
    this.queue.push({ topic, payload: JSON.stringify(message) });
  }

  private flush(now: number): void {
    while (this.queue.length && now - this.lastPublishAt >= this.config.minPublishGapMs) {
      const m = this.queue.shift()!;
      this.lastPublishAt = now;
      this.deps.publish(m.topic, m.payload);
    }
  }

  // ---- status -----------------------------------------------------------------------------

  private log(level: EngineEvent['level'], text: string): void {
    this.events.push({ at: this.deps.now(), level, text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /** Records a note from the host (for example MQTT connect/disconnect). */
  note(level: EngineEvent['level'], text: string): void {
    this.log(level, text);
  }

  gatewayStatus(now: number): 'Online' | 'Offline' | 'Unknown' {
    const g = this.gateway;
    if (g.lastSeen === null) return 'Unknown';
    if (g.reported === 'offline' || now - g.lastSeen > this.config.gatewayOfflineMs)
      return 'Offline';
    return 'Online';
  }

  private displayStatus(d: Device, now: number): DisplayStatus {
    const r = this.runtime.get(d.deviceId);
    if (r?.error) return 'Error';
    if (!r || r.lastSeen === null)
      return d.registrationStatus === 'Joining' ? 'Joining' : 'Registered';
    return now - r.lastSeen > this.config.deviceOfflineMs ? 'Offline' : 'Online';
  }

  getState() {
    const now = this.deps.now();
    const zones = [...this.zones.values()].map((zone) => {
      const device = this.devices.get(zone.deviceId)!;
      const r = this.rt(zone.deviceId);
      const status = this.displayStatus(device, now);
      const sensors: Record<
        string,
        {
          value: number;
          unit: string;
          receivedAt: number;
          deviceTimestamp: string;
          source: DataSource;
          freshness: 'live' | 'stale';
        }
      > = {};
      for (const kind of device.supportedSensors) {
        const s = r.sensors[kind];
        if (s)
          sensors[kind] = {
            ...s,
            freshness: now - s.receivedAt > this.config.staleMs ? 'stale' : 'live',
          };
      }
      return {
        zoneId: zone.zoneId,
        name: zone.name,
        settings: zone.settings,
        device: {
          ...device,
          status,
          lastSeen: r.lastSeen,
          lastSource: r.lastSource,
          error: r.error,
        },
        sensors,
        light: {
          supported: device.supportedActuators.includes('light'),
          // A reported state is only meaningful while the device is reachable.
          reportedState: status === 'Online' ? r.reportedLight : null,
          lastReportedState: r.reportedLight,
          reportedAt: r.reportedLightAt,
          reportedSource: r.reportedLightSource,
          command: r.command,
        },
      };
    });
    return {
      greenhouse: { id: this.config.greenhouseId, name: this.config.greenhouseName },
      gateway: {
        id: this.config.gatewayId,
        status: this.gatewayStatus(now),
        lastSeen: this.gateway.lastSeen,
        source: this.gateway.source,
      },
      zones,
      unassignedDevices: [...this.devices.values()].filter((d) => !d.zoneId),
      events: [...this.events].reverse(),
      serverTime: now,
    };
  }
}

export type EngineState = ReturnType<PrototypeEngine['getState']>;
export type ZoneState = EngineState['zones'][number];
