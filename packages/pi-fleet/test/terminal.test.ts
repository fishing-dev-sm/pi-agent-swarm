import assert from "node:assert/strict";
import { test } from "vitest";
import {
	createTerminalLaunchError,
	isTerminalLaunchError,
	normalizeTerminal,
} from "../src/terminal.js";
import { ZellijLaunchError } from "../src/zellij.js";

test("terminal helpers normalize and classify Zellij launch errors", () => {
	assert.equal(normalizeTerminal("zellij"), "zellij");
	assert.equal(isTerminalLaunchError(new ZellijLaunchError("partial", true, "terminal_7")), true);
	assert.ok(
		createTerminalLaunchError("zellij", "failed", true, "terminal_8") instanceof ZellijLaunchError,
	);
});
