import assert from "node:assert/strict";
import { test } from "vitest";
import {
  normalizeSwarmColor,
  pickSwarmColor,
  SWARM_COLOR_PALETTES,
  SWARM_COLORS,
  swarmColorName,
} from "../src/color.js";
import { ROLE_BADGE_BACKGROUND } from "../src/footer.js";

test("both GitHub-derived palettes share slot names and order", () => {
  const muted = SWARM_COLOR_PALETTES.muted.map((color) => color.name);
  const bright = SWARM_COLOR_PALETTES.bright.map((color) => color.name);
  assert.deepEqual(muted, ["red", "orange", "yellow", "green", "cyan", "blue", "magenta", "purple"]);
  assert.deepEqual(bright, muted);
  // The default palette is the muted set, and its yellow deliberately matches the
  // footer's ROLE badge so a yellow session reads as one warm block.
  assert.equal(SWARM_COLORS, SWARM_COLOR_PALETTES.muted);
  assert.equal(SWARM_COLOR_PALETTES.muted[2].hex, ROLE_BADGE_BACKGROUND.toLowerCase());
});

test("a seed keeps its hue slot across palettes", () => {
  for (const seed of ["MANAGER-a1b2c3d4", "Swarm 9f8e7d", "session-42", ""]) {
    const muted = pickSwarmColor(seed, SWARM_COLOR_PALETTES.muted);
    const bright = pickSwarmColor(seed, SWARM_COLOR_PALETTES.bright);
    assert.equal(swarmColorName(muted), swarmColorName(bright));
  }
});

test("normalizeSwarmColor resolves names against the given palette and lowercases hexes", () => {
  assert.equal(normalizeSwarmColor("red"), SWARM_COLOR_PALETTES.muted[0].hex);
  assert.equal(normalizeSwarmColor("red", SWARM_COLOR_PALETTES.bright), SWARM_COLOR_PALETTES.bright[0].hex);
  assert.equal(normalizeSwarmColor(" BLUE "), SWARM_COLOR_PALETTES.muted[5].hex);
  assert.equal(normalizeSwarmColor("#A97BFF"), "#a97bff");
  assert.equal(normalizeSwarmColor("neon"), undefined);
  assert.equal(normalizeSwarmColor(5), undefined);
});

test("legacy Tailwind hexes still resolve to palette names for labels", () => {
  assert.equal(swarmColorName("#ef4444"), "red");
  assert.equal(swarmColorName("#8b5cf6"), "purple");
  assert.equal(swarmColorName("#123456"), undefined);
});
