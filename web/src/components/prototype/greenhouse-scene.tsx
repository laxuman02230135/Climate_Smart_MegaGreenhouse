'use client';

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SensorKind } from '@/lib/prototype/types';
import type { LinkState } from '@/lib/prototype/zone-view';
import { cn } from '@/lib/utils';

/**
 * Interactive 3D greenhouse for the Prototype Testing Lab. It is one greenhouse that grows a bay
 * per configured zone; each bay carries that zone's sensors, bulb, relay and node. Everything it
 * shows comes from the props, which carry only values received over MQTT: a missing reading
 * leaves its object in a neutral look, and a bulb glows only when the node confirmed ON.
 *
 * World units are metres: x across the house, y up, z along it (door at +z, zone 1 nearest it).
 */

export type MarkerId =
  'temperature' | 'soilMoisture' | 'light' | 'bulb' | 'relay' | 'node' | 'gateway';

export interface SceneMarker {
  id: MarkerId;
  label: string;
  value: string;
}

export interface SceneZone {
  zoneId: string;
  name: string;
  link: LinkState;
  sensors: SensorKind[];
  hasLight: boolean;
  temperature: number | null;
  soilMoisture: number | null;
  light: number | null;
  /** The state the node confirmed, or null when it has not. */
  lightOn: boolean | null;
  /** One-line status for the zone's tag above the roof. */
  summary: string;
}

export interface GreenhouseSceneProps {
  zones: SceneZone[];
  gateway: { id: string; link: LinkState; value: string };
  /** Detail labels for the selected zone. */
  markers: SceneMarker[];
  selectedZone: string | null;
  selected: MarkerId | null;
  /** zoneId null keeps the current zone; id null clears the marker. */
  onSelect: (zoneId: string | null, id: MarkerId | null) => void;
}

const W = 6;
const BAY = 4.5;
const EAVE = 2.2;
const RIDGE = 3.3;
const HOME_DIR = new THREE.Vector3(9.5, 6.5, 11);
const HOME_TARGET = new THREE.Vector3(0, 1.1, 0);

type V3 = readonly [number, number, number];
type ZoneMarker = Exclude<MarkerId, 'gateway'>;

/** Label anchor of each fitting, relative to its bay centre (x, y, dz). */
const ANCHORS: Record<ZoneMarker, V3> = {
  temperature: [-2.82, 1.7, -0.8],
  soilMoisture: [-1.4, 0.8, 0.8],
  light: [2.7, 1.85, -1.2],
  bulb: [0, 2.2, 0],
  relay: [2.55, 0.95, 1.75],
  node: [1.75, 1.3, 1.75],
};
/** Labels drawn below their anchor instead of above, so neighbouring labels don't overlap. */
const BELOW = new Set<string>(['m:relay', 'm:bulb']);
/** Centre of each fitting, where the selection ring is drawn. */
const RING_AT: Record<ZoneMarker, V3> = {
  temperature: [-2.82, 1.3, -0.8],
  soilMoisture: [-1.4, 0.42, 0.8],
  light: [2.7, 1.64, -1.2],
  bulb: [0, 2.38, 0],
  relay: [2.45, 1.1, 1.75],
  node: [1.85, 1.08, 1.75],
};

const SOIL_NEUTRAL = new THREE.Color('#8f7556');
const SOIL_DRY = new THREE.Color('#b5915f');
const SOIL_WET = new THREE.Color('#3f2a19');
const T_NONE = new THREE.Color('#9ca3af');
const T_COLD = new THREE.Color('#3b82f6');
const T_MILD = new THREE.Color('#22c55e');
const T_HOT = new THREE.Color('#ef4444');
const SKY_DIM = new THREE.Color('#38463f');
const SKY_BRIGHT = new THREE.Color('#e3f1e6');
/** Colour scale for the temperature marker, °C. */
const TEMP_SCALE = { min: 18, max: 34 };
/** LDR ADC span the scene's daylight follows. */
const LIGHT_SCALE = { min: 120, max: 2000 };

const LED: Record<LinkState, string> = {
  online: '#22c55e',
  offline: '#ef4444',
  error: '#ef4444',
  waiting: '#f59e0b',
};

const norm = (v: number, lo: number, hi: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

function tempColor(t: number, out: THREE.Color): THREE.Color {
  const k = norm(t, TEMP_SCALE.min, TEMP_SCALE.max);
  return k < 0.45
    ? out.lerpColors(T_COLD, T_MILD, k / 0.45)
    : out.lerpColors(T_MILD, T_HOT, (k - 0.45) / 0.55);
}

/** Bay centres along z, zone 1 nearest the door. */
function bayCentres(count: number): number[] {
  const len = Math.max(1, count) * BAY;
  return Array.from({ length: Math.max(1, count) }, (_, i) => len / 2 - BAY * (i + 0.5));
}

function gatewayAt(count: number): V3 {
  return [W / 2 + 1.1, 0, (Math.max(1, count) * BAY) / 2 + 1.3];
}

interface SceneApi {
  setLayout(zoneIds: string[]): void;
  update(p: Pick<GreenhouseSceneProps, 'zones' | 'gateway' | 'selectedZone' | 'selected'>): void;
  reset(): void;
  /** Flies the camera to one zone's bay. */
  focus(zoneId: string): void;
  zoom(factor: number): void;
}

/** A thin box running between two points (frame members, cables). */
function beam(a: THREE.Vector3, b: THREE.Vector3, t: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, len), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b);
  m.castShadow = true;
  return m;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function gableShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-W / 2, 0);
  s.lineTo(W / 2, 0);
  s.lineTo(W / 2, EAVE);
  s.lineTo(0, RIDGE);
  s.lineTo(-W / 2, EAVE);
  s.closePath();
  return s;
}

function ledMaterial(color: string) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 });
}

/** One zone's bay: beds, plants and that zone's own fittings, each tagged for picking. */
interface Bay {
  zoneId: string | null;
  zc: number;
  soil: THREE.MeshStandardMaterial;
  tMat: THREE.MeshStandardMaterial;
  bulbMat: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshBasicMaterial;
  bulbLight: THREE.PointLight;
  nodeLedMat: THREE.MeshStandardMaterial;
  relayLedMat: THREE.MeshStandardMaterial;
  highlight: THREE.MeshBasicMaterial;
  parts: Record<'temperature' | 'soilMoisture' | 'light' | 'lightKit', THREE.Object3D[]>;
}

interface Materials {
  metal: THREE.Material;
  wood: THREE.Material;
  dark: THREE.Material;
  housing: THREE.Material;
  leaf: THREE.Material;
  leaf2: THREE.Material;
  stem: THREE.Material;
}

function buildBay(
  house: THREE.Group,
  pickable: THREE.Object3D[],
  zoneId: string | null,
  zc: number,
  m: Materials,
): Bay {
  const soil = new THREE.MeshStandardMaterial({ color: SOIL_NEUTRAL.clone(), roughness: 1 });
  const tag = (o: THREE.Object3D, marker: ZoneMarker | null) => {
    o.userData.zone = zoneId;
    o.userData.marker = marker;
    if (zoneId) pickable.push(o);
    house.add(o);
    return o;
  };

  // Selection tint on the bay floor.
  const highlight = new THREE.MeshBasicMaterial({
    color: '#22c55e',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const tint = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, BAY - 0.1), highlight);
  tint.rotation.x = -Math.PI / 2;
  tint.position.set(0, 0.02, zc);
  tag(tint, null);

  // Two soil beds with plants.
  const plantStem = new THREE.CylinderGeometry(0.025, 0.035, 0.32, 6);
  const plantLeaf = new THREE.SphereGeometry(0.13, 10, 8);
  for (const bx of [-1.4, 1.4]) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.36, 3.2), m.wood);
    bed.position.set(bx, 0.18, zc - 0.3);
    bed.castShadow = true;
    bed.receiveShadow = true;
    tag(bed, null);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.05, 3.04), soil);
    top.position.set(bx, 0.36, zc - 0.3);
    top.receiveShadow = true;
    tag(top, null);
    for (let i = 0; i < 3; i++) {
      for (const dx of [-0.35, 0.35]) {
        const p = new THREE.Group();
        p.position.set(bx + dx, 0.38, zc - 1.5 + i * 1.0 + (dx > 0 ? 0.45 : 0));
        const s = new THREE.Mesh(plantStem, m.stem);
        s.position.y = 0.16;
        p.add(s);
        for (let k = 0; k < 3; k++) {
          const lf = new THREE.Mesh(plantLeaf, k % 2 ? m.leaf2 : m.leaf);
          const a = (k / 3) * Math.PI * 2 + i + zc;
          lf.position.set(Math.cos(a) * 0.1, 0.3 + k * 0.05, Math.sin(a) * 0.1);
          lf.scale.set(1, 0.6, 1);
          lf.castShadow = true;
          p.add(lf);
        }
        house.add(p);
      }
    }
  }

  // An empty greenhouse (no zones yet) has beds but no fittings.
  const tMat = new THREE.MeshStandardMaterial({
    color: T_NONE.clone(),
    emissive: T_NONE.clone(),
    emissiveIntensity: 0.2,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#f3f4f6',
    emissive: '#ffd27a',
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.9,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: '#ffcf6b',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bulbLight = new THREE.PointLight('#ffc766', 0, 7, 1.6);
  const nodeLedMat = ledMaterial(LED.waiting);
  const relayLedMat = ledMaterial('#6b7280');
  const parts: Bay['parts'] = { temperature: [], soilMoisture: [], light: [], lightKit: [] };
  const bay: Bay = {
    zoneId,
    zc,
    soil,
    tMat,
    bulbMat,
    glowMat,
    bulbLight,
    nodeLedMat,
    relayLedMat,
    highlight,
    parts,
  };
  if (!zoneId) return bay;

  // Temperature sensor on the left wall post.
  const temp = new THREE.Group();
  temp.position.set(-2.82, 1.45, zc - 0.8);
  temp.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.16), m.housing));
  const tBulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), tMat);
  tBulb.position.y = -0.2;
  temp.add(tBulb);
  parts.temperature.push(tag(temp, 'temperature'));

  // Soil moisture probe pushed into the left bed.
  const probe = new THREE.Group();
  probe.position.set(-1.4, 0.38, zc + 0.8);
  const prongMat = new THREE.MeshStandardMaterial({
    color: '#d4a017',
    metalness: 0.6,
    roughness: 0.3,
  });
  for (const dx of [-0.05, 0.05]) {
    const pr = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.01), prongMat);
    pr.position.set(dx, 0, 0);
    probe.add(pr);
  }
  const pHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.14, 0.05),
    new THREE.MeshStandardMaterial({ color: '#2563eb' }),
  );
  pHead.position.y = 0.2;
  probe.add(pHead);
  parts.soilMoisture.push(tag(probe, 'soilMoisture'));

  // LDR on a short stand by the right wall.
  const ldr = new THREE.Group();
  ldr.position.set(2.7, 0, zc - 1.2);
  ldr.add(beam(v3(0, 0, 0), v3(0, 1.6, 0), 0.05, m.metal));
  const ldrHead = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 20), m.dark);
  ldrHead.position.y = 1.63;
  ldr.add(ldrHead);
  const ldrFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.02, 20),
    new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      emissive: '#f59e0b',
      emissiveIntensity: 0.3,
    }),
  );
  ldrFace.position.y = 1.67;
  ldr.add(ldrFace);
  parts.light.push(tag(ldr, 'light'));

  // Light bulb hanging from the ridge.
  const bulb = new THREE.Group();
  bulb.position.z = zc;
  bulb.add(beam(v3(0, RIDGE, 0), v3(0, 2.62, 0), 0.015, m.dark));
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 16), m.dark);
  socket.position.y = 2.56;
  bulb.add(socket);
  const bulbGlass = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), bulbMat);
  bulbGlass.position.y = 2.38;
  bulb.add(bulbGlass);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), glowMat);
  glow.position.y = 2.38;
  bulb.add(glow);
  bulbLight.position.y = 2.36;
  bulb.add(bulbLight);
  parts.lightKit.push(tag(bulb, 'bulb'));

  // Node and relay module on a bench at the front of the bay.
  const bz = zc + 1.75;
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.6), m.wood);
  bench.position.set(2.15, 1.0, bz);
  bench.castShadow = true;
  house.add(bench);
  for (const dx of [-0.6, 0.6])
    house.add(beam(v3(2.15 + dx, 0, bz), v3(2.15 + dx, 0.98, bz), 0.05, m.metal));

  const node = new THREE.Group();
  node.position.set(1.85, 1.08, bz);
  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.06, 0.26),
    new THREE.MeshStandardMaterial({ color: '#14532d' }),
  );
  pcb.castShadow = true;
  node.add(pcb);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.02, 0.1),
    new THREE.MeshStandardMaterial({
      color: '#0f172a',
      emissive: '#38bdf8',
      emissiveIntensity: 0.25,
    }),
  );
  screen.position.set(-0.05, 0.04, 0);
  node.add(screen);
  node.add(beam(v3(0.17, 0.03, -0.08), v3(0.17, 0.42, -0.08), 0.025, m.dark));
  const nodeLed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), nodeLedMat);
  nodeLed.position.set(0.12, 0.05, 0.08);
  node.add(nodeLed);
  tag(node, 'node');

  const relay = new THREE.Group();
  relay.position.set(2.45, 1.1, bz);
  const relayBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.16),
    new THREE.MeshStandardMaterial({ color: '#1d4ed8' }),
  );
  relayBox.castShadow = true;
  relay.add(relayBox);
  const relayLed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), relayLedMat);
  relayLed.position.set(0.06, 0.06, 0.05);
  relay.add(relayLed);
  parts.lightKit.push(tag(relay, 'relay'));

  // Cable from the relay up to the bulb, along the ridge.
  const cableMat = new THREE.MeshStandardMaterial({ color: '#374151' });
  const cable = new THREE.Group();
  cable.add(beam(v3(2.45, 1.15, bz), v3(2.9, 2.15, bz), 0.015, cableMat));
  cable.add(beam(v3(2.9, 2.15, bz), v3(0.05, RIDGE - 0.05, bz), 0.015, cableMat));
  cable.add(beam(v3(0.05, RIDGE - 0.05, bz), v3(0.05, RIDGE - 0.05, zc), 0.015, cableMat));
  house.add(cable);
  parts.lightKit.push(cable);

  return bay;
}

/** The greenhouse shell sized for `count` bays, its bays, and the gateway by the door. */
function buildHouse(zoneIds: string[]) {
  const house = new THREE.Group();
  const pickable: THREE.Object3D[] = [];
  const L = Math.max(1, zoneIds.length) * BAY;
  const metal = new THREE.MeshStandardMaterial({
    color: '#e8ece9',
    metalness: 0.4,
    roughness: 0.45,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: '#cdeedd',
    transparent: true,
    opacity: 0.16,
    roughness: 0.05,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mats: Materials = {
    metal,
    wood: new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.6 }),
    housing: new THREE.MeshStandardMaterial({ color: '#f5f5f0', roughness: 0.6 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#2f8f4e', roughness: 0.7 }),
    leaf2: new THREE.MeshStandardMaterial({ color: '#4fb36a', roughness: 0.7 }),
    stem: new THREE.MeshStandardMaterial({ color: '#3d6b2f', roughness: 0.8 }),
  };

  // Ground and floor.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(22, L + 12), 48),
    new THREE.MeshStandardMaterial({ color: '#7fae6a', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  house.add(ground);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, L),
    new THREE.MeshStandardMaterial({ color: '#cfc8b8', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  house.add(floor);

  // Frame: posts, eaves, ridge and rafters every 1.5 m.
  for (let z = -L / 2; z <= L / 2 + 1e-6; z += 1.5) {
    const l1 = v3(-W / 2, EAVE, z);
    const r1 = v3(W / 2, EAVE, z);
    const top = v3(0, RIDGE, z);
    house.add(beam(v3(-W / 2, 0, z), l1, 0.07, metal), beam(v3(W / 2, 0, z), r1, 0.07, metal));
    house.add(beam(l1, top, 0.06, metal), beam(r1, top, 0.06, metal));
  }
  for (const [x, y] of [
    [-W / 2, EAVE],
    [W / 2, EAVE],
    [0, RIDGE],
    [-W / 2, 0.02],
    [W / 2, 0.02],
  ] as const) {
    house.add(beam(v3(x, y, -L / 2), v3(x, y, L / 2), 0.07, metal));
  }

  // Translucent panels: side walls, roof slopes and both gables.
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, EAVE), glass);
    wall.position.set((sx * W) / 2, EAVE / 2, 0);
    wall.rotation.y = Math.PI / 2;
    house.add(wall);
    const slope = Math.hypot(W / 2, RIDGE - EAVE);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(slope, L), glass);
    roof.position.set((sx * W) / 4, (EAVE + RIDGE) / 2, 0);
    roof.rotation.order = 'ZXY';
    roof.rotation.x = -Math.PI / 2;
    roof.rotation.z = -sx * Math.atan2(RIDGE - EAVE, W / 2);
    house.add(roof);
  }
  const gable = new THREE.ShapeGeometry(gableShape());
  for (const z of [-L / 2, L / 2]) {
    const g = new THREE.Mesh(gable, glass);
    g.position.z = z;
    house.add(g);
  }

  // Door on the front gable.
  const door = new THREE.Group();
  door.position.set(0, 0, L / 2 + 0.02);
  const doorFrame = new THREE.MeshStandardMaterial({ color: '#1e6b41', roughness: 0.5 });
  door.add(beam(v3(-0.55, 0, 0), v3(-0.55, 2, 0), 0.08, doorFrame));
  door.add(beam(v3(0.55, 0, 0), v3(0.55, 2, 0), 0.08, doorFrame));
  door.add(beam(v3(-0.59, 2, 0), v3(0.59, 2, 0), 0.08, doorFrame));
  const leafPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 1.96),
    new THREE.MeshStandardMaterial({
      color: '#a7d8bd',
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  leafPanel.position.set(0, 0.98, 0.01);
  door.add(leafPanel);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), metal);
  handle.position.set(0.38, 1, 0.06);
  door.add(handle);
  house.add(door);

  // Zone dividers on the floor between bays.
  const divider = new THREE.MeshStandardMaterial({ color: '#1e6b41', roughness: 0.6 });
  for (let i = 1; i < zoneIds.length; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.02, 0.06), divider);
    strip.position.set(0, 0.02, L / 2 - BAY * i);
    house.add(strip);
  }

  const centres = bayCentres(zoneIds.length);
  const bays = centres.map((zc, i) => buildBay(house, pickable, zoneIds[i] ?? null, zc, mats));

  // Wi-Fi LoRa gateway on a post outside the door.
  const [gx, , gz] = gatewayAt(zoneIds.length);
  const gateway = new THREE.Group();
  gateway.position.set(gx, 0, gz);
  gateway.add(beam(v3(0, 0, 0), v3(0, 1.5, 0), 0.06, metal));
  const gwBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.26, 0.16),
    new THREE.MeshStandardMaterial({ color: '#f5f5f0', roughness: 0.5 }),
  );
  gwBox.position.y = 1.6;
  gwBox.castShadow = true;
  gateway.add(gwBox);
  gateway.add(beam(v3(0.12, 1.72, 0), v3(0.12, 2.15, 0), 0.025, mats.dark));
  const gwLedMat = ledMaterial('#6b7280');
  const gwLed = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), gwLedMat);
  gwLed.position.set(-0.1, 1.64, 0.085);
  gateway.add(gwLed);
  gateway.userData.zone = null;
  gateway.userData.marker = 'gateway';
  pickable.push(gateway);
  house.add(gateway);

  return { house, pickable, bays, gwLedMat, length: L };
}

type House = ReturnType<typeof buildHouse>;

export function GreenhouseScene({
  zones,
  gateway,
  markers,
  selectedZone,
  selected,
  onSelect,
}: GreenhouseSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const labelRefs = useRef(new Map<string, HTMLButtonElement>());
  const onSelectRef = useRef(onSelect);
  const [failed, setFailed] = useState(false);
  const layoutKey = zones.map((z) => z.zoneId).join('|');

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      // No WebGL (old device, disabled GPU): show the text fallback instead.
      queueMicrotask(() => setFailed(true));
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'block h-full w-full touch-none';
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = SKY_BRIGHT.clone();
    const fog = new THREE.Fog(scene.background, 24, 46);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

    const hemi = new THREE.HemisphereLight('#f0fff4', '#5b7b4a', 1.1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff7e0', 1.6);
    sun.position.set(-6, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reduceMotion;
    controls.minDistance = 5;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.enablePan = false;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let house: House | null = null;
    let scale = 1;
    let state = {
      selectedZone: null as string | null,
      links: new Map<string, LinkState>(),
      gatewayLink: 'waiting' as LinkState,
    };

    // Camera moves ease over ~0.6 s, or jump when motion is reduced.
    let fly: {
      p0: THREE.Vector3;
      t0: THREE.Vector3;
      p1: THREE.Vector3;
      t1: THREE.Vector3;
      at: number;
    } | null = null;
    const moveTo = (pos: THREE.Vector3, target: THREE.Vector3) => {
      if (reduceMotion) {
        fly = null;
        camera.position.copy(pos);
        controls.target.copy(target);
        controls.update();
        return;
      }
      fly = {
        p0: camera.position.clone(),
        t0: controls.target.clone(),
        p1: pos,
        t1: target,
        at: performance.now(),
      };
    };
    const home = () => moveTo(HOME_DIR.clone().multiplyScalar(scale), HOME_TARGET.clone());

    const dispose = (root: THREE.Object3D) =>
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of [o.material].flat()) (m as THREE.Material).dispose();
        }
      });

    // Click vs drag: only a press that barely moved selects something.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const shown = (o: THREE.Object3D | null): boolean => {
      for (; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!house || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(house.pickable, true).find((h) => shown(h.object));
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !('marker' in o.userData)) o = o.parent;
      onSelectRef.current(
        (o?.userData.zone as string | null | undefined) ?? null,
        (o?.userData.marker as MarkerId | null | undefined) ?? null,
      );
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    // Selection ring that floats around the selected fitting.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.025, 8, 32),
      new THREE.MeshBasicMaterial({ color: '#22c55e', transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);

    const centreOf = (zoneId: string | null) =>
      house?.bays.find((b) => b.zoneId === zoneId && zoneId)?.zc ?? null;
    const color = new THREE.Color();

    apiRef.current = {
      setLayout(zoneIds) {
        const prevLength = house?.length;
        if (house) {
          scene.remove(house.house);
          dispose(house.house);
        }
        house = buildHouse(zoneIds);
        scene.add(house.house);
        scale = THREE.MathUtils.clamp((house.length + 4) / 13, 0.75, 3);
        controls.maxDistance = 26 * scale;
        fog.near = 24 * scale;
        fog.far = 46 * scale;
        const half = Math.max(8, house.length / 2 + 3);
        Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
        sun.shadow.camera.updateProjectionMatrix();
        // Frame the whole house again when it grew or shrank, so a new zone is in view.
        if (prevLength === undefined) {
          camera.position.copy(HOME_DIR).multiplyScalar(scale);
          controls.target.copy(HOME_TARGET);
          controls.update();
        } else if (prevLength !== house.length) home();
      },
      update(p) {
        if (!house) return;
        state = {
          selectedZone: p.selectedZone,
          links: new Map(p.zones.map((z) => [z.zoneId, z.link])),
          gatewayLink: p.gateway.link,
        };
        const lights: number[] = [];
        for (const bay of house.bays) {
          const z = p.zones.find((zn) => zn.zoneId === bay.zoneId);
          bay.highlight.opacity = z && z.zoneId === p.selectedZone && p.zones.length > 1 ? 0.14 : 0;
          if (!z) continue;
          for (const o of bay.parts.temperature) o.visible = z.sensors.includes('temperature');
          for (const o of bay.parts.soilMoisture) o.visible = z.sensors.includes('soilMoisture');
          for (const o of bay.parts.light) o.visible = z.sensors.includes('light');
          for (const o of bay.parts.lightKit) o.visible = z.hasLight;

          if (z.soilMoisture === null) bay.soil.color.copy(SOIL_NEUTRAL);
          else bay.soil.color.lerpColors(SOIL_DRY, SOIL_WET, norm(z.soilMoisture, 15, 90));
          if (z.temperature === null) color.copy(T_NONE);
          else tempColor(z.temperature, color);
          bay.tMat.color.copy(color);
          bay.tMat.emissive.copy(color);
          bay.tMat.emissiveIntensity = z.temperature === null ? 0.2 : 0.6;
          if (z.light !== null) lights.push(z.light);

          const on = z.lightOn === true;
          bay.bulbMat.emissiveIntensity = on ? 2.2 : 0;
          bay.glowMat.opacity = on ? 0.28 : 0;
          bay.bulbLight.intensity = on ? 7 : 0;
          const relay = z.lightOn === null ? '#6b7280' : on ? '#22c55e' : '#ef4444';
          bay.relayLedMat.color.set(relay);
          bay.relayLedMat.emissive.set(relay);
          bay.nodeLedMat.color.set(LED[z.link]);
          bay.nodeLedMat.emissive.set(LED[z.link]);
        }
        const gw = p.gateway.link === 'waiting' ? '#6b7280' : LED[p.gateway.link];
        house.gwLedMat.color.set(gw);
        house.gwLedMat.emissive.set(gw);

        // Daylight follows the LDR readings received; with none, the scene keeps its neutral day.
        const day = lights.length
          ? Math.sqrt(
              norm(
                lights.reduce((a, b) => a + b, 0) / lights.length,
                LIGHT_SCALE.min,
                LIGHT_SCALE.max,
              ),
            )
          : 1;
        hemi.intensity = lights.length ? 0.35 + 0.95 * day : 1.1;
        sun.intensity = lights.length ? 0.15 + 1.75 * day : 1.6;
        (scene.background as THREE.Color).lerpColors(SKY_DIM, SKY_BRIGHT, day);
        fog.color.copy(scene.background as THREE.Color);

        const zc = centreOf(p.selectedZone);
        if (p.selected === 'gateway') {
          const [gx, , gz] = gatewayAt(house.bays.filter((b) => b.zoneId).length);
          ring.position.set(gx, 1.6, gz);
          ring.visible = true;
        } else if (p.selected && zc !== null) {
          const [x, y, dz] = RING_AT[p.selected];
          ring.position.set(x, y, zc + dz);
          ring.visible = true;
        } else {
          ring.visible = false;
        }
      },
      reset: home,
      focus(zoneId) {
        const zc = centreOf(zoneId);
        if (zc === null) return;
        const target = v3(0, 1.1, zc);
        moveTo(HOME_DIR.clone().multiplyScalar(0.8).add(target), target);
      },
      zoom(f) {
        const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
        const d = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
        camera.position.copy(controls.target).add(off.setLength(d));
        controls.update();
      },
    };

    const anchor = (key: string, out: THREE.Vector3): boolean => {
      if (!house) return false;
      const count = house.bays.filter((b) => b.zoneId).length;
      if (key === 'gateway') {
        const [gx, , gz] = gatewayAt(count);
        out.set(gx, 2.2, gz);
        return true;
      }
      if (key.startsWith('tag:')) {
        const zc = centreOf(key.slice(4));
        if (zc === null) return false;
        out.set(0, RIDGE + 0.45, zc);
        return true;
      }
      const zc = centreOf(state.selectedZone);
      const a = ANCHORS[key.slice(2) as ZoneMarker];
      if (zc === null || !a) return false;
      out.set(a[0], a[1], zc + a[2]);
      return true;
    };

    const v = new THREE.Vector3();
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (fly) {
        const k = Math.min(1, (t - fly.at) / 600);
        const e = 1 - (1 - k) ** 3;
        camera.position.lerpVectors(fly.p0, fly.p1, e);
        controls.target.lerpVectors(fly.t0, fly.t1, e);
        if (k === 1) fly = null;
      }
      controls.update();
      // Blinking LEDs for anything online, and a gently pulsing ring; still when motion is reduced.
      if (!reduceMotion && house) {
        const blink = 0.4 + 0.8 * (Math.sin(t / 220) > 0 ? 1 : 0);
        for (const bay of house.bays) {
          const link = bay.zoneId ? state.links.get(bay.zoneId) : undefined;
          bay.nodeLedMat.emissiveIntensity = link === 'online' ? blink : 1;
        }
        house.gwLedMat.emissiveIntensity = state.gatewayLink === 'online' ? blink : 1;
        ring.scale.setScalar(1 + 0.08 * Math.sin(t / 300));
      }
      renderer.render(scene, camera);
      const w = host.clientWidth;
      const h = host.clientHeight;
      for (const [key, el] of labelRefs.current) {
        const ok = anchor(key, v);
        if (ok) v.project(camera);
        const visible = ok && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        el.style.opacity = visible ? '1' : '0';
        el.style.pointerEvents = visible ? '' : 'none';
        el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, ${BELOW.has(key) ? '8px' : '-100%'})`;
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      dispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setLayout(layoutKey ? layoutKey.split('|') : []);
  }, [layoutKey]);

  // Picking another zone flies to its bay. The first selection, and a selection that moved
  // because zones were added or removed, keep the whole-house view instead.
  const focused = useRef({ zone: selectedZone, layout: layoutKey });
  useEffect(() => {
    const prev = focused.current;
    focused.current = { zone: selectedZone, layout: layoutKey };
    if (selectedZone && prev.zone && selectedZone !== prev.zone && prev.layout === layoutKey)
      apiRef.current?.focus(selectedZone);
  }, [selectedZone, layoutKey]);

  useEffect(() => {
    apiRef.current?.update({ zones, gateway, selectedZone, selected });
  }, [zones, gateway, selectedZone, selected, layoutKey]);

  if (failed) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-text-2">
        3D view unavailable: this browser could not start WebGL. Every reading is still shown in the
        cards and the zone list.
      </div>
    );
  }

  const label = (key: string, active: boolean, onClick: () => void, children: React.ReactNode) => (
    <button
      key={key}
      type="button"
      ref={(el) => {
        if (el) labelRefs.current.set(key, el);
        else labelRefs.current.delete(key);
      }}
      onClick={onClick}
      aria-pressed={active}
      style={{ opacity: 0 }}
      className={cn(
        'proto-label pointer-events-auto absolute left-0 top-0 max-w-[220px] rounded-lg border px-2 py-1 text-left text-[11px] leading-tight shadow-sm backdrop-blur transition-colors',
        active
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-white/60 bg-white/85 text-[#13201a] hover:bg-white',
      )}
    >
      {children}
    </button>
  );

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        {zones.map((z) =>
          label(
            `tag:${z.zoneId}`,
            z.zoneId === selectedZone && !selected,
            () => onSelect(z.zoneId, null),
            <>
              <span className="block font-semibold">
                {z.name} · {z.zoneId}
              </span>
              {z.summary.split(' · ').map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </>,
          ),
        )}
        {markers.map((m) =>
          label(
            `m:${m.id}`,
            selected === m.id,
            () => onSelect(null, selected === m.id ? null : m.id),
            <>
              <span className="block font-semibold">{m.label}</span>
              <span className="tabular block">{m.value}</span>
            </>,
          ),
        )}
        {label(
          'gateway',
          selected === 'gateway',
          () => onSelect(null, selected === 'gateway' ? null : 'gateway'),
          <>
            <span className="block font-semibold">Gateway {gateway.id}</span>
            <span className="block">{gateway.value}</span>
          </>,
        )}
      </div>
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <SceneButton label="Zoom in" onClick={() => apiRef.current?.zoom(0.8)}>
          <Plus />
        </SceneButton>
        <SceneButton label="Zoom out" onClick={() => apiRef.current?.zoom(1.25)}>
          <Minus />
        </SceneButton>
        <SceneButton label="Reset view" onClick={() => apiRef.current?.reset()} wide>
          <RotateCcw />
          <span>Reset view</span>
        </SceneButton>
      </div>
    </div>
  );
}

function SceneButton({
  label,
  onClick,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/60 bg-white/90 text-xs font-medium text-[#13201a] shadow-sm backdrop-blur hover:bg-white [&_svg]:size-4',
        wide ? 'px-3' : 'w-9',
      )}
    >
      {children}
    </button>
  );
}
