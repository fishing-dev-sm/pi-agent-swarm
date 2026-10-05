import assert from "node:assert/strict";
import { test } from "vitest";
import { ExternalLaunchError } from "../src/external.js";
import { createTerminalLaunchError, isTerminalLaunchError } from "../src/terminal.js";

test("terminal launch errors classify and wrap the external backend", () => {
  assert.equal(isTerminalLaunchError(new ExternalLaunchError("partial", true, "win-7")), true);
  assert.ok(createTerminalLaunchError("failed", true, "win-8") instanceof ExternalLaunchError);
});
