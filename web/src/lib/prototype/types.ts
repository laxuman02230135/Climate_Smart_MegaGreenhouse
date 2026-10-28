/** Shared names for the Prototype Testing Lab (/prototype-testing). */

export type SensorKind = 'temperature' | 'soilMoisture' | 'light';

export const SENSOR_LABEL: Record<SensorKind, string> = {
  temperature: 'Temperature',
  soilMoisture: 'Soil Moisture',
  light: 'LDR',
};
