import {
  Droplet, Zap, Hammer, Wind, Settings, Camera, Wrench, PaintRoller, Sparkles,
  Bug, Truck, Trees, Lock, Refrigerator, WashingMachine, Flame, Lightbulb,
  DoorOpen, ShowerHead, Sofa, Shield, Plug, Fan, Thermometer, Cctv, Cable,
  Microwave, Blinds, Ruler, Boxes,
} from 'lucide-react';

/**
 * Category icon registry.
 *
 * The catalogue stores an icon *name* (seeded in `backend/src/db/seeds/categories.js`),
 * not a component - the database has no business importing React. This maps
 * those names onto real glyphs so a category reads at a glance instead of as
 * its first letter.
 *
 * Extra aliases are listed deliberately: when someone adds a category later
 * they are far more likely to type "ac" or "cctv" than to look up the exact
 * lucide export, and a sensible guess beats a fallback.
 */
const ICONS = {
  // Seeded names
  droplet: Droplet,
  zap: Zap,
  hammer: Hammer,
  wind: Wind,
  settings: Settings,
  camera: Camera,

  // Common aliases for categories added later
  wrench: Wrench,
  plumbing: Droplet,
  electrical: Zap,
  electric: Zap,
  carpentry: Hammer,
  ac: Wind,
  fan: Fan,
  cooling: Thermometer,
  appliance: Settings,
  cctv: Cctv,
  security: Shield,
  lock: Lock,
  painting: PaintRoller,
  paint: PaintRoller,
  cleaning: Sparkles,
  sparkles: Sparkles,
  pest: Bug,
  moving: Truck,
  gardening: Trees,
  fridge: Refrigerator,
  refrigerator: Refrigerator,
  washing: WashingMachine,
  geyser: Flame,
  flame: Flame,
  light: Lightbulb,
  lighting: Lightbulb,
  door: DoorOpen,
  bathroom: ShowerHead,
  furniture: Sofa,
  plug: Plug,
  cable: Cable,
  microwave: Microwave,
  blinds: Blinds,
  measure: Ruler,
};

/**
 * Falls back to a neutral box rather than to nothing.
 *
 * A missing icon must never collapse the tile it sits in - the grid would go
 * ragged for one unrecognised name.
 */
export default function categoryIcon(name) {
  if (!name) return Boxes;
  return ICONS[String(name).toLowerCase().trim()] ?? Boxes;
}

export { ICONS };
