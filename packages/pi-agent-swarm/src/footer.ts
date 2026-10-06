import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { badge, contrastTextColor } from "./color.js";
import { safeTerminalLine } from "./text.js";

/** Uniform warning-cream background for the footer role badge (LEADER and WORKER alike). */
export const ROLE_BADGE_BACKGROUND = "#ffc85a";
/**
 * Fraction of the terminal columns the roster badge may occupy. The built-in footer
 * segments (cwd, git, model, context usage) take the rest; their width is not knowable
 * from the extension API, so the budget scales with the window instead of a fixed reserve.
 */
export const FOOTER_WIDTH_FRACTION = 0.55;
/** A short session id is the UUID prefix used by MANAGER-<id> naming and /lead matching. */
export const SHORT_ID_LENGTH = 8;
/** Column count assumed when the terminal does not report one (headless, piped output). */
export const DEFAULT_TERMINAL_COLUMNS = 80;
/** Below this a truncated name fragment carries no recognizable identity; drop to MINIMAL. */
const MIN_NAME_BUDGET = 8;
/** The ` ● ` prefix and trailing space around a non-empty name badge. */
const NAME_BADGE_OVERHEAD = 4;

export interface FooterBadgeInput {
  name?: string;
  sessionId: string;
  color: string;
  role: "LEADER" | "WORKER";
  columns: number;
}

/**
 * Build the roster footer badge, degrading through three width tiers:
 * FULL (name + full id + role), COMPACT (name truncated with an ellipsis + 8-column
 * short id + role), and MINIMAL (color dot + role). The role badge always survives:
 * telling LEADER from WORKER at a glance is the badge's primary purpose. The short id
 * is a first-class identifier (MANAGER-<prefix> naming and /lead prefix matching), so
 * unlike a truncated name it carries no ellipsis.
 */
export function buildRosterBadge(input: FooterBadgeInput): string {
  const name = input.name ? safeTerminalLine(input.name) : "";
  const sessionId = safeTerminalLine(input.sessionId);
  const roleBadge = badge(` ${input.role} `, ROLE_BADGE_BACKGROUND, "#000000");
  const nameBadge = (value: string) =>
    badge(value ? ` ● ${value} ` : " ● ", input.color, contrastTextColor(input.color));
  const available = Math.max(0, Math.floor(input.columns * FOOTER_WIDTH_FRACTION));

  // FULL: the complete identifier set, unchanged from the original single-mode badge.
  const full = `${nameBadge(name)}${badge(` ${sessionId} `, "#ffffff", "#000000")}${roleBadge}`;
  if (visibleWidth(full) <= available) return full;

  // COMPACT: shorten the id first (it is recoverable through /lead prefix matching),
  // then give the name whatever budget remains.
  const shortId = [...sessionId].slice(0, SHORT_ID_LENGTH).join("");
  const shortIdBadge = badge(` ${shortId} `, "#ffffff", "#000000");
  const nameBudget = available - visibleWidth(roleBadge) - visibleWidth(shortIdBadge) - NAME_BADGE_OVERHEAD;
  if (nameBudget >= MIN_NAME_BUDGET) {
    const truncated = visibleWidth(name) > nameBudget ? truncateToWidth(name, nameBudget, "…") : name;
    return `${nameBadge(truncated)}${shortIdBadge}${roleBadge}`;
  }

  // MINIMAL: the swarm-colored dot is the identity; the full name and id stay
  // available through the /swarm menu and message envelopes.
  return `${nameBadge("")}${roleBadge}`;
}
