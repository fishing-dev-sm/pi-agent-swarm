import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

const repositoryRoot = process.cwd();
const changesetBin = path.join(repositoryRoot, "node_modules", ".bin", "changeset");
const changesetConfig = path.join(repositoryRoot, ".changeset", "config.json");

test("Changesets bumps selected packages independently and preserves ordinary internal ranges", () => {
	const fixture = mkdtempSync(path.join(tmpdir(), "pi-changesets-"));
	try {
		writeJson(path.join(fixture, "package.json"), {
			name: "fixture-root",
			private: true,
			workspaces: ["packages/*"],
		});
		writeJson(path.join(fixture, "package-lock.json"), {
			lockfileVersion: 3,
			requires: true,
			packages: {
				"": {
					name: "fixture-root",
					workspaces: ["packages/*"],
				},
			},
		});
		writeJson(path.join(fixture, "packages/pi-tui-kit/package.json"), {
			name: "@fixture/pi-tui-kit",
			version: "0.49.3",
		});
		writeJson(path.join(fixture, "packages/pi-consumer/package.json"), {
			name: "@fixture/pi-consumer",
			version: "1.2.3",
			dependencies: { "@fixture/pi-tui-kit": "^0.49.1" },
		});
		writeJson(path.join(fixture, "packages/pi-unchanged/package.json"), {
			name: "@fixture/pi-unchanged",
			version: "4.5.6",
		});
		mkdirSync(path.join(fixture, ".changeset"), { recursive: true });
		copyFileSync(changesetConfig, path.join(fixture, ".changeset/config.json"));
		writeFileSync(
			path.join(fixture, ".changeset/independent.md"),
			[
				"---",
				'"@fixture/pi-tui-kit": minor',
				'"@fixture/pi-consumer": patch',
				"---",
				"",
				"Release selected packages independently.",
				"",
			].join("\n"),
		);

		execFileSync(changesetBin, ["version"], { cwd: fixture, stdio: "pipe" });

		const kit = readJson(path.join(fixture, "packages/pi-tui-kit/package.json"));
		const consumer = readJson(path.join(fixture, "packages/pi-consumer/package.json"));
		const unchanged = readJson(path.join(fixture, "packages/pi-unchanged/package.json"));
		assert.equal(kit.version, "0.50.0");
		assert.equal(consumer.version, "1.2.4");
		assert.deepEqual(consumer.dependencies, { "@fixture/pi-tui-kit": "^0.49.1" });
		assert.equal(unchanged.version, "4.5.6");
		assert.equal(existsSync(path.join(fixture, "packages/pi-unchanged/CHANGELOG.md")), false);
		assert.match(
			readFileSync(path.join(fixture, "packages/pi-tui-kit/CHANGELOG.md"), "utf8"),
			/## 0\.50\.0/u,
		);
		assert.match(
			readFileSync(path.join(fixture, "packages/pi-consumer/CHANGELOG.md"), "utf8"),
			/## 1\.2\.4/u,
		);
		assert.deepEqual(readdirSync(path.join(fixture, ".changeset")).sort(), ["config.json"]);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

function readJson(filePath: string): {
	version?: string;
	dependencies?: Record<string, string>;
} {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, value: unknown) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}
