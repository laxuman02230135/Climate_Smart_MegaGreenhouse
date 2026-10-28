import { z } from 'zod';

/**
 * Application-side message protocol for the Prototype Testing Lab's real MQTT path:
 *
 *   Backend <-> EMQX Cloud <-> Wi-Fi LoRa gateway <-> LoRa device nodes
 *
 * These are the schemas the backend validates and the shapes MQTTX tests (and, later, firmware)
 * must follow. Nothing here implies that any physical gateway or node already speaks this
 * protocol: the LoRa side is still to be built.
 */

export const TOPIC_ROOT = 'kye-phel/v1';
export const ID_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

export type DeviceTopicKind = 'telemetry' | 'status' | 'commands' | 'ack';

export const gatewayStatusTopic = (gatewayId: string) =>
  `${TOPIC_ROOT}/gateways/${gatewayId}/status`;
export const deviceTopic = (zoneId: string, deviceId: string, kind: DeviceTopicKind) =>
  `${TOPIC_ROOT}/zones/${zoneId}/devices/${deviceId}/${kind}`;

/** Topics the backend subscribes to (commands are only ever published, never consumed). */
export const SUBSCRIPTIONS = [
  `${TOPIC_ROOT}/gateways/+/status`,
  `${TOPIC_ROOT}/zones/+/devices/+/telemetry`,
  `${TOPIC_ROOT}/zones/+/devices/+/status`,
  `${TOPIC_ROOT}/zones/+/devices/+/ack`,
  // Current two-zone Heltec gateway uplinks. They are mapped server-side to the
  // prototype telemetry contract; browsers never connect to EMQX directly.
  'greenhouse/+/sensors',
] as const;

export type ParsedTopic =
  | { kind: 'gatewayStatus'; gatewayId: string }
  | { kind: 'telemetry' | 'status' | 'ack'; zoneId: string; deviceId: string };

/** Returns null for any topic outside the convention, or with an invalid ID segment. */
export function parseTopic(topic: string): ParsedTopic | null {
  const p = topic.split('/');
  const root = TOPIC_ROOT.split('/');
  if (p.length < root.length || root.some((r, i) => p[i] !== r)) return null;
  const rest = p.slice(root.length);
  if (rest.length === 3 && rest[0] === 'gateways' && rest[2] === 'status') {
    return ID_PATTERN.test(rest[1]!) ? { kind: 'gatewayStatus', gatewayId: rest[1]! } : null;
  }
  if (rest.length === 5 && rest[0] === 'zones' && rest[2] === 'devices') {
    const kind = rest[4];
    if (kind !== 'telemetry' && kind !== 'status' && kind !== 'ack') return null;
    if (!ID_PATTERN.test(rest[1]!) || !ID_PATTERN.test(rest[3]!)) return null;
    return { kind, zoneId: rest[1]!, deviceId: rest[3]! };
  }
  return null;
}

export const SENSOR_KEYS = ['temperature', 'soilMoisture', 'lightIntensity'] as const;
export type SensorKey = (typeof SENSOR_KEYS)[number];

/** Plausible physical limits; anything outside is rejected as a malformed reading. */
export const SENSOR_LIMITS: Record<SensorKey, { min: number; max: number; unit: string }> = {
  temperature: { min: -40, max: 100, unit: '°C' },
  soilMoisture: { min: 0, max: 100, unit: '%' },
  lightIntensity: { min: 0, max: 65535, unit: 'ADC' },
};

const id = z.string().regex(ID_PATTERN);
const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid timestamp');
const messageId = z.string().min(1).max(64);
/** `test` marks MQTTX/manual payloads so the UI never presents them as physical measurements. */
const source = z.enum(['device', 'test']).optional();

const sensorValue = z.object({
  value: z.number().finite(),
  unit: z.string().max(12).optional(),
});

export const telemetrySchema = z.object({
  messageType: z.literal('TELEMETRY'),
  messageId,
  greenhouseId: id.optional(),
  zoneId: id,
  gatewayId: id.optional(),
  deviceId: id,
  timestamp: isoTime,
  source,
  sensors: z.record(z.string(), sensorValue).default({}),
  actuators: z.object({ light: z.object({ state: z.enum(['ON', 'OFF']) }).optional() }).optional(),
});
export type Telemetry = z.infer<typeof telemetrySchema>;

const capabilities = z.object({
  sensors: z.array(z.string().max(32)).max(16).default([]),
  actuators: z.array(z.string().max(32)).max(16).default([]),
});

/** HEARTBEAT, JOIN_REQUEST and ERROR share the device `status` topic. */
export const deviceStatusSchema = z.object({
  messageType: z.enum(['HEARTBEAT', 'JOIN_REQUEST', 'ERROR']),
  messageId: messageId.optional(),
  zoneId: id,
  gatewayId: id.optional(),
  deviceId: id,
  timestamp: isoTime,
  source,
  capabilities: capabilities.optional(),
  error: z.object({ code: z.string().max(32), message: z.string().max(200) }).optional(),
  actuators: z.object({ light: z.object({ state: z.enum(['ON', 'OFF']) }).optional() }).optional(),
});
export type DeviceStatusMessage = z.infer<typeof deviceStatusSchema>;

export const gatewayStatusSchema = z.object({
  messageType: z.literal('HEARTBEAT'),
  messageId: messageId.optional(),
  gatewayId: id,
  status: z.enum(['online', 'offline']).default('online'),
  timestamp: isoTime,
  source,
});
export type GatewayStatusMessage = z.infer<typeof gatewayStatusSchema>;

export const ackSchema = z.object({
  messageType: z.literal('ACK'),
  messageId: messageId.optional(),
  commandId: z.string().min(1).max(64),
  deviceId: id,
  zoneId: id,
  actuator: z.literal('light'),
  requestedAction: z.enum(['ON', 'OFF']),
  status: z.enum(['success', 'failed']),
  reportedState: z.enum(['ON', 'OFF']).optional(),
  error: z.string().max(200).optional(),
  timestamp: isoTime,
  source,
});
export type AckMessage = z.infer<typeof ackSchema>;

export interface CommandMessage {
  messageType: 'COMMAND';
  commandId: string;
  deviceId: string;
  zoneId: string;
  gatewayId: string;
  actuator: 'light';
  action: 'ON' | 'OFF';
  timestamp: string;
}

export interface JoinAcceptedMessage {
  messageType: 'JOIN_ACCEPTED';
  deviceId: string;
  zoneId: string;
  gatewayId: string;
  timestamp: string;
}

/** Parses UTF-8 JSON, returning null instead of throwing on bad input. */
export function parseJson(raw: string | Uint8Array): unknown {
  if (typeof raw !== 'string' && raw.length > 8192) return null;
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  if (text.length > 8192) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
