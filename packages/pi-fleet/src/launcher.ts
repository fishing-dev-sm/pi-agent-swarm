import { randomBytes } from "node:crypto";
import { lstat, open, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { PiInvocation } from "./pi-invocation.js";

export interface PiLauncher {
	path: string;
	command: string;
	cleanup(): Promise<void>;
}

export async function createPiLauncher(
	invocation: PiInvocation,
	directory: string,
): Promise<PiLauncher> {
	await assertPrivateDirectory(directory);
	const launcherPath = join(directory, `launch-${randomBytes(8).toString("hex")}.sh`);
	assertInside(directory, launcherPath);
	const command = [invocation.command, ...invocation.args];
	for (const value of command) {
		if (value.includes("\0")) throw new Error("Pi Fleet launcher argument contains a NUL byte");
	}
	const source = `#!/bin/sh\nexec ${command.map(quoteShell).join(" ")}\n`;
	const handle = await open(launcherPath, "wx", 0o700);
	try {
		await handle.writeFile(source, "utf8");
		await handle.sync();
		await handle.chmod(0o700);
	} finally {
		await handle.close();
	}
	let cleaned = false;
	return {
		path: launcherPath,
		command: launcherPath,
		async cleanup() {
			if (cleaned) return;
			cleaned = true;
			assertInside(directory, launcherPath);
			await rm(launcherPath, { force: true });
		},
	};
}

function quoteShell(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function assertPrivateDirectory(path: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new Error("Pi Fleet launcher directory is invalid");
	}
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
		throw new Error("Pi Fleet launcher directory has another owner");
	}
	if ((info.mode & 0o777) !== 0o700) {
		throw new Error("Pi Fleet launcher directory permissions are not private");
	}
}

function assertInside(parent: string, candidate: string): void {
	const rel = relative(resolve(parent), resolve(candidate));
	if (!rel || rel === ".." || rel.startsWith("../")) {
		throw new Error("Pi Fleet launcher path escapes its runtime directory");
	}
}
