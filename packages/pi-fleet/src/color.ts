import { getTerminalColorMode, parseColor, styleText } from "@earendil-works/pi-tui";

export interface FleetColor {
  name: string;
  hex: string;
}

export const FLEET_COLORS: readonly FleetColor[] = [
  { name: "red", hex: "#ef4444" },
  { name: "orange", hex: "#f97316" },
  { name: "yellow", hex: "#eab308" },
  { name: "green", hex: "#22c55e" },
  { name: "cyan", hex: "#06b6d4" },
  { name: "blue", hex: "#3b82f6" },
  { name: "magenta", hex: "#d946ef" },
  { name: "purple", hex: "#8b5cf6" },
];

const HEX_RE = /^#[0-9a-f]{6}$/u;
const NAME_TO_HEX = new Map(FLEET_COLORS.map((c) => [c.name, c.hex]));
const HEX_TO_NAME = new Map(FLEET_COLORS.map((c) => [c.hex, c.name]));

/** Accept a palette name or a #rrggbb hex; return a normalized #rrggbb hex, or undefined. */
export function normalizeFleetColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  const named = NAME_TO_HEX.get(trimmed);
  if (named) return named;
  if (HEX_RE.test(trimmed)) return trimmed;
  return undefined;
}

/** Deterministic palette color from a seed string (stable, no coordination needed). */
export function pickFleetColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return FLEET_COLORS[hash % FLEET_COLORS.length].hex;
}

/** Palette name for a hex, or undefined when the hex is off-palette. */
export function fleetColorName(hex: string): string | undefined {
  return HEX_TO_NAME.get(hex.toLowerCase());
}

/** Wrap text in a foreground color escape sequence (ANSI), best-effort. */
export function colorize(text: string, hex: string): string {
  try {
    return styleText(text, { fg: parseColor(hex) }, getTerminalColorMode());
  } catch {
    return text;
  }
}

/** Wrap text in a bold escape sequence (ANSI), best-effort. */
export function boldText(text: string): string {
  try {
    return styleText(text, { bold: true }, getTerminalColorMode());
  } catch {
    return text;
  }
}
