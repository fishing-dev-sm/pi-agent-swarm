import { getTerminalColorMode, parseColor, styleText } from "@earendil-works/pi-tui";

export interface SwarmColor {
  name: string;
  hex: string;
}

export type SwarmColorPaletteName = "muted" | "bright";

/**
 * Roster palettes derived from GitHub Linguist language colors (the language bar on
 * github.com), one language per hue slot (see scripts/color-draft.mjs for the visual
 * draft). `muted` is the default low-saturation set; its yellow deliberately matches
 * the footer's ROLE badge (ROLE_BADGE_BACKGROUND) so a yellow session reads as one
 * warm block. `bright` keeps the same slots at GitHub's original vivid tones. Both
 * palettes share slot order, so a seed or stored name keeps its hue when the
 * `colorPalette` setting switches.
 */
export const SWARM_COLOR_PALETTES: Record<SwarmColorPaletteName, readonly SwarmColor[]> = {
  muted: [
    { name: "red", hex: "#c22d40" }, // Scala
    { name: "orange", hex: "#b07219" }, // Java
    { name: "yellow", hex: "#ffc85a" }, // matches ROLE_BADGE_BACKGROUND in footer.ts
    { name: "green", hex: "#41b883" }, // Vue
    { name: "cyan", hex: "#4298b8" }, // Groovy
    { name: "blue", hex: "#3178c6" }, // TypeScript
    { name: "magenta", hex: "#b83998" }, // Erlang
    { name: "purple", hex: "#8847b9" }, // Elixir
  ],
  bright: [
    { name: "red", hex: "#db5855" }, // Clojure
    { name: "orange", hex: "#dea584" }, // Rust
    { name: "yellow", hex: "#f1e05a" }, // JavaScript
    { name: "green", hex: "#89e051" }, // Shell
    { name: "cyan", hex: "#00add8" }, // Go
    { name: "blue", hex: "#3572a5" }, // Python
    { name: "magenta", hex: "#f34b7d" }, // C++
    { name: "purple", hex: "#a97bff" }, // Kotlin
  ],
};

/** Default roster palette: the muted GitHub-derived set. */
export const SWARM_COLORS: readonly SwarmColor[] = SWARM_COLOR_PALETTES.muted;

/**
 * Pre-palette Tailwind colors. Kept only so hexes assigned by older versions still
 * resolve to a palette name in labels; never used for new assignments.
 */
const LEGACY_SWARM_COLORS: readonly SwarmColor[] = [
  { name: "red", hex: "#ef4444" },
  { name: "orange", hex: "#f97316" },
  { name: "yellow", hex: "#eab308" },
  { name: "green", hex: "#22c55e" },
  { name: "cyan", hex: "#06b6d4" },
  { name: "blue", hex: "#3b82f6" },
  { name: "magenta", hex: "#d946ef" },
  { name: "purple", hex: "#8b5cf6" },
];

/** The palette behind a `colorPalette` setting value. */
export function swarmColorPalette(name: SwarmColorPaletteName): readonly SwarmColor[] {
  return SWARM_COLOR_PALETTES[name];
}

const HEX_RE = /^#[0-9a-f]{6}$/u;
const HEX_TO_NAME = new Map<string, string>();
for (const palette of [SWARM_COLOR_PALETTES.muted, SWARM_COLOR_PALETTES.bright, LEGACY_SWARM_COLORS]) {
  for (const color of palette) {
    if (!HEX_TO_NAME.has(color.hex)) HEX_TO_NAME.set(color.hex, color.name);
  }
}

/** Accept a palette name or a #rrggbb hex; return a normalized #rrggbb hex, or undefined. */
export function normalizeSwarmColor(value: unknown, palette: readonly SwarmColor[] = SWARM_COLORS): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  const named = palette.find((color) => color.name === trimmed);
  if (named) return named.hex;
  if (HEX_RE.test(trimmed)) return trimmed;
  return undefined;
}

/** Deterministic palette color from a seed string (stable, no coordination needed). */
export function pickSwarmColor(seed: string, palette: readonly SwarmColor[] = SWARM_COLORS): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length].hex;
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
