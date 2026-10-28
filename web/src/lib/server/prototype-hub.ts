import 'server-only';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import {
  EngineError,
  PrototypeEngine,
  type EngineConfig,
  type LightState,
  type Registry,
} from '@/lib/prototype/engine';
import { deviceTopic, gatewayStatusTopic, SUBSCRIPTIONS } from '@/lib/prototype/protocol';

/**
 * Owns the one backend MQTT connection to EMQX Cloud for the Prototype Testing Lab and the
 * engine that interprets its messages. Credentials come only from server environment variables
 * and never reach the browser. TLS certificates are verified (rejectUnauthorized is left at its
 * secure default).
 */

export type MqttStatus =
  'not-configured' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

interface MqttSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  clientId: string;
}

export function readMqttSettings(env: NodeJS.ProcessEnv = process.env): {
  settings: MqttSettings | null;
  missing: string[];
} {
  const get = (k: string) => env[k]?.trim() ?? '';
  const missing = ['MQTT_HOST', 'MQTT_USERNAME', 'MQTT_PASSWORD'].filter((k) => !get(k));
  const port = Number(get('MQTT_PORT') || '8883');
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('MQTT_PORT (invalid)');
  if (missing.length) return { settings: null, missing };
  return {
    missing,
    settings: {
      host: get('MQTT_HOST'),
      port,
      username: get('MQTT_USERNAME'),
      password: get('MQTT_PASSWORD'),
      clientId: get('MQTT_CLIENT_ID') || 'kheyphel-prototype-backend',
    },
  };
}

function loadRegistry(file: string): Registry | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Registry;
    return Array.isArray(raw.devices) && Array.isArray(raw.zones) ? raw : null;
  } catch {
    return null;
  }
}

function saveRegistry(file: string, reg: Registry): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(reg, null, 2));
  } catch (e) {
    console.warn('[prototype] could not save the registry:', (e as Error).message);
  }
}

export class PrototypeHub {
  readonly engine: PrototypeEngine;
  private client: MqttClient | null = null;
  private status: MqttStatus = 'not-configured';
  private lastConnectedAt: number | null = null;
  private lastError: string | null = null;
  private readonly settings: MqttSettings | null;
  private readonly missing: string[];
  private inboundMessageCounter = 0;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const { settings, missing } = readMqttSettings(env);
    this.settings = settings;
    this.missing = missing;
    const file = resolve(process.cwd(), env.PROTOTYPE_DATA_FILE ?? '.data/prototype-registry.json');
    const config: Partial<EngineConfig> = {};
    if (env.PROTOTYPE_GREENHOUSE_ID) config.greenhouseId = env.PROTOTYPE_GREENHOUSE_ID;
    if (env.PROTOTYPE_GATEWAY_ID) config.gatewayId = env.PROTOTYPE_GATEWAY_ID;
    this.engine = new PrototypeEngine(
      {
        publish: (topic, payload) => this.publish(topic, payload),
        onRegistryChange: (reg) => saveRegistry(file, reg),
      },
      config,
    );
    const saved = loadRegistry(file);
    if (saved) {
      this.engine.importRegistry(saved);
    } else {
      // Fixed initial registry for the two-zone laboratory prototype.
      this.engine.addZone({
        zoneId: 'Z1',
        zoneName: 'Zone 1',
        deviceId: 'NODE1',
        deviceName: 'Zone 1 Heltec',
        sensors: ['temperature', 'soilMoisture', 'light'],
        light: true,
      });
      this.engine.addZone({
        zoneId: 'Z2',
        zoneName: 'Zone 2',
        deviceId: 'NODE2',
        deviceName: 'Zone 2 Heltec',
        sensors: ['temperature', 'soilMoisture'],
        light: true,
      });
    }
    const timer = setInterval(() => this.engine.tick(), 250);
    timer.unref();
    if (settings) this.connect(settings);
  }

  /** Strips credentials from anything that might be shown or logged. */
  private clean(text: string): string {
    let out = text;
    for (const s of [this.settings?.password, this.settings?.username]) {
      if (s) out = out.split(s).join('***');
    }
    return out;
  }

/**
   * Adapts the existing Heltec gateway uplink payload to the dashboard contract.
   * The gateway currently publishes JSON on greenhouse/zone1/sensors and
   * greenhouse/zone2/sensors. This keeps MQTT credentials server-side and avoids
   * requiring a firmware change merely to display live readings.
   */
  private handleCurrentGatewayUplink(topic: string, payload: Uint8Array): boolean {
    const topicMatch = /^greenhouse\/zone([12])\/sensors$/.exec(topic);
    if (!topicMatch) return false;

    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      this.engine.note('warn', `Ignored malformed gateway JSON on ${topic}.`);
      return true;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.engine.note('warn', `Ignored non-object gateway JSON on ${topic}.`);
      return true;
    }

    const value = raw as Record<string, unknown>;
    const zoneNumber = Number(topicMatch[1]);
    if (value.zone !== zoneNumber) {
      this.engine.note('warn', `Ignored gateway payload with a zone/topic mismatch on ${topic}.`);
      return true;
    }

    const validNumber = (key: string, min: number, max: number): number | null => {
      const n = value[key];
      return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
    };
    const sensors: Record<string, { value: number; unit: string }> = {};
    const temperature = validNumber('temperature_c', -40, 100);
    const soil = validNumber('soil_percent', 0, 100);
    const light = validNumber('ldr_raw', 0, 4095);
    if (temperature !== null) sensors.temperature = { value: temperature, unit: '°C' };
    if (soil !== null) sensors.soilMoisture = { value: soil, unit: '%' };
    if (light !== null) sensors.lightIntensity = { value: light, unit: 'ADC' };
    if (Object.keys(sensors).length === 0) {
      this.engine.note('warn', `Ignored ${topic}: no valid sensor readings.`);
      return true;
    }

    const now = new Date().toISOString();
    const zoneId = `Z${zoneNumber}`;
    const deviceId = `NODE${zoneNumber}`;
    const messageId = `gateway-${zoneNumber}-${Date.now()}-${++this.inboundMessageCounter}`;
    const gatewayId = this.engine.config.gatewayId;

    // Every valid uplink also proves that the gateway path is reachable.
    this.engine.handleMessage(
      gatewayStatusTopic(gatewayId),
      JSON.stringify({
        messageType: 'HEARTBEAT',
        messageId,
        gatewayId,
        status: 'online',
        timestamp: now,
      }),
    );
    this.engine.handleMessage(
      deviceTopic(zoneId, deviceId, 'telemetry'),
      JSON.stringify({
        messageType: 'TELEMETRY',
        messageId,
        greenhouseId: this.engine.config.greenhouseId,
        zoneId,
        gatewayId,
        deviceId,
        timestamp: now,
        sensors,
      }),
    );
    return true;
  }
  private connect(s: MqttSettings): void {
    this.status = 'connecting';
    const client = mqtt.connect({
      protocol: 'mqtts',
      host: s.host,
      port: s.port,
      username: s.username,
      password: s.password,
      clientId: s.clientId,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 15_000,
    });
    this.client = client;
    client.on('connect', () => {
      this.status = 'connected';
      this.lastConnectedAt = Date.now();
      this.lastError = null;
      client.subscribe([...SUBSCRIPTIONS], { qos: 1 }, (err) => {
        if (err) {
          this.lastError = this.clean(err.message);
          this.engine.note('warn', `MQTT subscribe failed: ${this.lastError}`);
        }
      });
      this.engine.note('info', `Backend connected to EMQX (${s.host}).`);
    });
    client.on('reconnect', () => {
      this.status = 'reconnecting';
    });
    client.on('offline', () => {
      if (this.status === 'connected')
        this.engine.note('warn', 'Backend lost the EMQX connection.');
      this.status = 'disconnected';
    });
    client.on('error', (err) => {
      this.status = 'error';
      this.lastError = this.clean(err.message || 'Connection error');
      console.warn('[prototype] MQTT error:', this.lastError);
    });
    client.on('message', (topic, payload) => {
      if (!this.handleCurrentGatewayUplink(topic, payload)) this.engine.handleMessage(topic, payload);
    });
  }

  private publish(topic: string, payload: string): void {
    if (!this.client || this.status !== 'connected') {
      this.engine.note('warn', 'A message was not sent because EMQX is not connected.');
      return;
    }
    this.client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) this.engine.note('warn', `MQTT publish failed: ${this.clean(err.message)}`);
    });
  }

  sendLight(zoneId: string, action: LightState) {
    if (this.status !== 'connected')
      throw new EngineError(503, 'MQTT_DISCONNECTED', 'The backend is not connected to EMQX.');
    return this.engine.sendLight(zoneId, action);
  }

  getState() {
    return {
      ...this.engine.getState(),
      mqtt: {
        status: this.status,
        host: this.settings?.host ?? null,
        port: this.settings?.port ?? null,
        clientId: this.settings?.clientId ?? null,
        missing: this.missing,
        lastConnectedAt: this.lastConnectedAt,
        lastError: this.lastError,
      },
    };
  }
}

const KEY = Symbol.for('kyephel.prototype.hub');

/** One hub per server process (survives hot reloads in development). */
export function getHub(): PrototypeHub {
  const g = globalThis as unknown as Record<symbol, PrototypeHub | undefined>;
  return (g[KEY] ??= new PrototypeHub());
}
