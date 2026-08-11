import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { createPiLauncher } from "../src/launcher.js";

test("launcher quotes paths and arguments, stays private, excludes secrets, and cleans once", async () => {
	const directory = await mkdtemp("/tmp/pi-fleet-launcher-test-");
	try {
		const launcher = await createPiLauncher(
			{
				command: "/runtime path/it's-node",
				args: ["/package path/cli.js", "--name", "child's name"],
			},
			directory,
		);
		const source = await readFile(launcher.path, "utf8");
		assert.match(source, /^#!\/bin\/sh\n/u);
		assert.match(source, /exec '\/runtime path\/it'"'"'s-node'/u);
		assert.match(source, /'child'"'"'s name'/u);
		assert.doesNotMatch(source, /pifleet:v1|PI_FLEET_INVITE|secret/u);
		assert.equal((await stat(launcher.path)).mode & 0o777, 0o700);
		assert.equal(launcher.command, launcher.path);
		await launcher.cleanup();
		await launcher.cleanup();
		await assert.rejects(access(launcher.path));
		assert.equal(join(directory, "."), directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
