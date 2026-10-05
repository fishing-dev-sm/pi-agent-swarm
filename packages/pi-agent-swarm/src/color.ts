import { getTerminalColorMode, parseColor, styleText } from "@earendil-works/pi-tui";

export interface SwarmColor {
  name: string;
  hex: string;
}

export const SWARM_COLORS: readonly SwarmColor[] = [
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
const NAME_TO_HEX = new Map(SWARM_COLORS.map((c) => [c.name, c.hex]));
const HEX_TO_NAME = new Map(SWARM_COLORS.map((c) => [c.hex, c.name]));

/** Accept a palette name or a #rrggbb hex; return a normalized #rrggbb hex, or undefined. */
export function normalizeSwarmColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  const named = NAME_TO_HEX.get(trimmed);
  if (named) return named;
  if (HEX_RE.test(trimmed)) return trimmed;
  return undefined;
}

/** Deterministic palette color from a seed string (stable, no coordination needed). */
export function pickSwarmColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return SWARM_COLORS[hash % SWARM_COLORS.length].hex;
}

/** Palette name for a hex, or undefined when the hex is off-palette. */
export function swarmColorName(hex: string): string | undefined {
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

/**
 * Pick black or white text for a filled badge on the given background, using WCAG
 * relative luminance so the choice is measured rather than eyeballed.
 */
export function contrastTextColor(bgHex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/u.exec(bgHex.toLowerCase());
  if (!match) return "#ffffff";
  const [r, g, b] = match.slice(1).map((pair) => Number.parseInt(pair, 16));
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const onBlack = (luminance + 0.05) / 0.05;
  const onWhite = 1.05 / (luminance + 0.05);
  return onBlack >= onWhite ? "#000000" : "#ffffff";
}

/** Wrap text in a filled badge (background with an explicit foreground), best-effort. */
export function badge(text: string, bgHex: string, fgHex: string): string {
  try {
    return styleText(text, { fg: parseColor(fgHex), bg: parseColor(bgHex) }, getTerminalColorMode());
  } catch {
    return text;
  }
}
