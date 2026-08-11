import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { createGroup } from "../src/protocol.js";
import {
	createEndpointPaths,
	defaultRuntimeBaseDirectory,
	ensureGroupRuntimeDirectory,
	publishManifest,
} from "../src/runtime-directory.js";

const posixTest = process.platform === "win32" ? test.skip : test;

test("default macOS runtime path leaves room for Unix socket names", () => {
	if (process.platform !== "darwin") return;
	const base = defaultRuntimeBaseDirectory();
	assert.match(base, /^\/tmp\/pi-fleet-/u);
	assert.equal(
		Buffer.byteLength(join(base, "0".repeat(32), `${"x".repeat(24)}.sock`)) <= 103,
		true,
	);
});

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp("/tmp/pi-fleet-runtime-test-");
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

posixTest(
	"runtime directories and manifests are private, regular, and atomically published",
	async () => {
		await fixture(async (base) => {
			const group = createGroup(Buffer.alloc(32, 4));
			const directory = await ensureGroupRuntimeDirectory(group.id, { baseDirectory: base });
			assert.equal((await stat(directory)).mode & 0o777, 0o700);
			const paths = createEndpointPaths(directory, "endpoint1234abcd");
			await publishManifest(paths.manifestPath, {
				protocolVersion: 1,
				sessionId: "session-a",
				endpointPath: paths.socketPath,
				pid: process.pid,
			});
			assert.equal((await stat(paths.manifestPath)).mode & 0o777, 0o600);
			assert.equal((await lstat(paths.manifestPath)).isFile(), true);
			assert.deepEqual(JSON.parse(await readFile(paths.manifestPath, "utf8")), {
				protocolVersion: 1,
				sessionId: "session-a",
				endpointPath: paths.socketPath,
				pid: process.pid,
			});
		});
	},
);

posixTest(
	"runtime setup rejects symlinked roots and socket paths beyond the POSIX budget",
	async () => {
		await fixture(async (base) => {
			const target = join(base, "target");
			const linked = join(base, "linked");
			await mkdir(target, { mode: 0o700 });
			await symlink(target, linked);
			await assert.rejects(
				ensureGroupRuntimeDirectory("0".repeat(32), { baseDirectory: linked }),
				/symbolic link/u,
			);
			const longBase = join(base, "x".repeat(90));
			await assert.rejects(
				ensureGroupRuntimeDirectory("0".repeat(32), { baseDirectory: longBase }),
				/socket path/u,
			);
		});
	},
);
