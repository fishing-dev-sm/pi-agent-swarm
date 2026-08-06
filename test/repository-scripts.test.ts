import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import test from "node:test";

const repositoryRoot = process.cwd();
const boundaryScript = path.join(repositoryRoot, "scripts/check-extension-boundaries.mjs");
const checkScript = path.join(repositoryRoot, "scripts/run-checks.mjs");
const runTypechecksScript = path.join(repositoryRoot, "scripts/run-typechecks.mjs");
const setPiVersionScript = path.join(repositoryRoot, "scripts/set-pi-version.mjs");
const expectedChecks = ["biome:check", "check:boundaries", "test", "typecheck"];

test("pi-tui-kit consumers use a bounded compatible zero-major range", () => {
	const consumers: string[] = [];
	for (const entry of readdirSync(path.join(repositoryRoot, "packages"), {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const manifestPath = path.join(repositoryRoot, "packages", entry.name, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (manifest.pi?.extensions === undefined) continue;
		const range = manifest.dependencies?.["@narumitw/pi-tui-kit"];
		if (range === undefined) continue;
		consumers.push(manifest.name);
		const match = /^\^0\.(\d+)\.(\d+)$/.exec(range);
		assert.ok(match, `${manifest.name} must use a bounded ^0.minor.patch pi-tui-kit range`);
		assert.ok(Number(match[1]) >= 40, `${manifest.name} must require pi-tui-kit 0.40 or newer`);
	}
	assert.ok(consumers.length > 0, "expected at least one pi-tui-kit consumer");
});

test("latest-Pi setup updates library, production, and experimental workspaces", () => {
	const fixture = mkdtempSync(path.join(tmpdir(), "pi-version-workspaces-"));
	try {
		writeJson(path.join(fixture, "package.json"), {
			name: "fixture-root",
			private: true,
			devDependencies: { "@earendil-works/pi-coding-agent": "1.0.0" },
		});
		writeJson(path.join(fixture, "packages/pi-tui-kit/package.json"), {
			name: "@fixture/menu",
			devDependencies: { "@earendil-works/pi-coding-agent": "1.0.0" },
		});
		writeJson(path.join(fixture, "packages/pi-public/package.json"), {
			name: "@fixture/public",
			devDependencies: { "@earendil-works/pi-tui": "1.0.0" },
		});
		writeJson(path.join(fixture, "packages/pi-manual/package.json"), {
			name: "@fixture/manual-experiment",
			devDependencies: { "@earendil-works/pi-ai": "1.0.0" },
		});

		const fixtureScript = path.join(fixture, "scripts/set-pi-version.mjs");
		mkdirSync(path.dirname(fixtureScript), { recursive: true });
		writeFileSync(fixtureScript, readFileSync(setPiVersionScript, "utf8"));
		execFileSync(process.execPath, [fixtureScript, "9.9.9"], { cwd: fixture });
		assert.equal(
			JSON.parse(readFileSync(path.join(fixture, "package.json"), "utf8")).devDependencies[
				"@earendil-works/pi-coding-agent"
			],
			"9.9.9",
		);
		assert.equal(
			JSON.parse(readFileSync(path.join(fixture, "packages/pi-tui-kit/package.json"), "utf8"))
				.devDependencies["@earendil-works/pi-coding-agent"],
			"9.9.9",
		);
		assert.equal(
			JSON.parse(readFileSync(path.join(fixture, "packages/pi-manual/package.json"), "utf8"))
				.devDependencies["@earendil-works/pi-ai"],
			"9.9.9",
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("dependency updates pin tooling and verify a clean lockfile installation", () => {
	const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
	assert.match(manifest.packageManager, /^npm@\d/u);
	assert.match(manifest.devDependencies["npm-check-updates"], /^\d+\.\d+\.\d+$/u);

	const justfile = readFileSync(path.join(repositoryRoot, "justfile"), "utf8");
	const pinnedNpm = justfile.indexOf("_require-pinned-npm:");
	const cleanWorktree = justfile.indexOf("_require-clean-worktree:");
	const updateLock = justfile.indexOf("update-lock:");
	const updateNcu = justfile.indexOf("npm exec -- npm-check-updates", updateLock);
	const generateLock = justfile.indexOf("npm install --package-lock-only", updateNcu);
	const verifyUpdate = justfile.indexOf("verify-update:");
	const cleanInstall = justfile.indexOf("npm ci", verifyUpdate);
	const checks = justfile.indexOf("npm run check", cleanInstall);
	const pack = justfile.indexOf("npm pack --workspaces --dry-run", checks);

	assert.ok(pinnedNpm >= 0, "dependency updates must verify packageManager");
	assert.ok(cleanWorktree > pinnedNpm, "dependency updates must reject a dirty worktree");
	assert.ok(updateLock > cleanWorktree, "update-lock must follow its preflights");
	assert.ok(updateNcu > updateLock, "update-lock must use the pinned npm-check-updates binary");
	assert.ok(generateLock > updateNcu, "update-lock must regenerate package-lock.json");
	assert.ok(verifyUpdate > generateLock, "verification must be independently rerunnable");
	assert.ok(cleanInstall > verifyUpdate, "verification must start from npm ci");
	assert.ok(checks > cleanInstall, "checks must run against the clean install");
	assert.ok(pack > checks, "workspace pack smokes must run after checks");
});

test("Changesets config keeps every package independently versioned", () => {
	const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
	const config = JSON.parse(
		readFileSync(path.join(repositoryRoot, ".changeset/config.json"), "utf8"),
	);
	const justfile = readFileSync(path.join(repositoryRoot, "justfile"), "utf8");

	assert.equal(manifest.devDependencies["@changesets/cli"], "2.31.1");
	assert.equal(
		manifest.scripts["version-packages"],
		"changeset version && npm install --package-lock-only --ignore-scripts",
	);
	assert.equal(manifest.scripts["publish-packages"], "changeset publish");
	assert.deepEqual(config.fixed, []);
	assert.deepEqual(config.linked, []);
	assert.equal(config.access, "public");
	assert.equal(config.baseBranch, "main");
	assert.equal(config.bumpVersionsWithWorkspaceProtocolOnly, true);
	assert.match(justfile, /^changeset:/m);
	assert.match(justfile, /^changeset-status:/m);
	assert.doesNotMatch(justfile, /^version-packages:|^publish-|^bump /m);
	assert.doesNotMatch(justfile, /^(?:(?:pack|install)-[a-z0-9]|try-(?!all:)[a-z0-9])/m);
	assert.equal(existsSync(path.join(repositoryRoot, ".github/workflows/bump-version.yml")), false);
	assert.equal(existsSync(path.join(repositoryRoot, ".github/workflows/release.yml")), false);
});

test("Changesets workflow pins tooling, validates, versions, and trusted-publishes", () => {
	const workflowPath = ".github/workflows/publish.yml";
	const workflow = readFileSync(path.join(repositoryRoot, workflowPath), "utf8");
	const setup = workflow.indexOf(
		'package_manager="$(node -p \'require("./package.json").packageManager\')"',
	);
	const install = workflow.indexOf('npm install --global "$package_manager"');
	const verify = workflow.search(/test "\$\(npm --version\)" = "\$\{package_manager#npm@\}"/u);
	const cleanInstall = workflow.indexOf("run: npm ci");
	const check = workflow.indexOf("run: npm run check", cleanInstall);
	const action = workflow.indexOf("changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d");

	assert.ok(setup >= 0, `${workflowPath} must read packageManager`);
	assert.ok(install > setup, `${workflowPath} must install packageManager`);
	assert.ok(verify > install, `${workflowPath} must verify packageManager`);
	assert.ok(cleanInstall > verify, `${workflowPath} must pin npm before npm ci`);
	assert.ok(check > cleanInstall, `${workflowPath} must validate the clean install`);
	assert.ok(action > check, `${workflowPath} must validate before Changesets`);
	assert.match(workflow, /branches:\n\s+- main/);
	assert.match(workflow, /fetch-depth: 0/);
	assert.match(workflow, /contents: write/);
	assert.match(workflow, /pull-requests: write/);
	assert.match(workflow, /id-token: write/);
	assert.match(workflow, /github-token: \$\{\{ secrets\.PAT_TOKEN \}\}/);
	assert.match(workflow, /version: npm run version-packages/);
	assert.match(workflow, /publish: npm run publish-packages/);
	assert.match(workflow, /createGithubReleases: true/);
	assert.match(workflow, /commitMode: github-api/);
	assert.match(workflow, /NPM_CONFIG_PROVENANCE: "true"/);
});

test("flat workspaces classify stable and experimental extensions explicitly", () => {
	const rootManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
	assert.deepEqual(rootManifest.workspaces, ["packages/*"]);

	const packagesRoot = path.join(repositoryRoot, "packages");
	const stableEntries: string[] = [];
	let extensionCount = 0;
	let experimentalCount = 0;
	let libraryCount = 0;
	for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = path.join(packagesRoot, entry.name, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (manifest.pi?.extensions === undefined) {
			libraryCount += 1;
			assert.equal(manifest.piExtension, undefined);
			continue;
		}
		extensionCount += 1;
		assert.ok(["stable", "experimental"].includes(manifest.piExtension?.lifecycle));
		if (manifest.piExtension.lifecycle === "experimental") experimentalCount += 1;
		else stableEntries.push(`./packages/${entry.name}/src/index.ts`);
	}

	assert.equal(extensionCount, 25);
	assert.equal(experimentalCount, 6);
	assert.equal(libraryCount, 1);
	assert.deepEqual([...rootManifest.pi.extensions].sort(), stableEntries.sort());
});

test("extension boundaries allow helper libraries but still reject extension dependencies", () => {
	const fixture = mkdtempSync(path.join(tmpdir(), "pi-boundaries-"));
	try {
		writeJson(path.join(fixture, "package.json"), {
			name: "fixture",
			private: true,
			pi: {
				extensions: ["./packages/pi-alpha/src/index.ts", "./packages/pi-beta/src/index.ts"],
			},
		});
		writeJson(path.join(fixture, "tsconfig.json"), {
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
			},
			include: ["packages/**/*.ts"],
		});
		writeLibraryFixture(fixture, "pi-tui-kit", "@narumitw/pi-tui-kit");
		writeExtensionFixture(fixture, "pi-alpha", "@narumitw/pi-alpha", {
			"@narumitw/pi-tui-kit": "<1",
		});
		writeExtensionFixture(fixture, "pi-beta", "@narumitw/pi-beta", {});

		const allowed = spawnSync(process.execPath, [boundaryScript], {
			cwd: fixture,
			encoding: "utf8",
		});
		assert.equal(allowed.status, 0, allowed.stderr);
		assert.match(allowed.stdout, /1 libraries and 2 active extensions/);

		const alphaEntrypoint = path.join(fixture, "packages/pi-alpha/src/index.ts");
		writeFileSync(alphaEntrypoint, 'export { default } from "../dist/extension.js";\n');
		const outsideSource = spawnSync(process.execPath, [boundaryScript], {
			cwd: fixture,
			encoding: "utf8",
		});
		assert.equal(outsideSource.status, 1);
		assert.match(outsideSource.stderr, /default export must stay inside its src directory/);
		writeFileSync(alphaEntrypoint, 'export { default } from "./extension.js";\n');

		const libraryPath = path.join(fixture, "packages/pi-tui-kit/package.json");
		const library = JSON.parse(readFileSync(libraryPath, "utf8"));
		library.piExtension = { lifecycle: "stable" };
		writeJson(libraryPath, library);
		const invalidLibrary = spawnSync(process.execPath, [boundaryScript], {
			cwd: fixture,
			encoding: "utf8",
		});
		assert.equal(invalidLibrary.status, 1);
		assert.match(invalidLibrary.stderr, /libraries must not declare piExtension metadata/);
		delete library.piExtension;
		writeJson(libraryPath, library);

		const alphaPath = path.join(fixture, "packages/pi-alpha/package.json");
		const alpha = JSON.parse(readFileSync(alphaPath, "utf8"));
		alpha.dependencies["@narumitw/pi-beta"] = "<1";
		writeJson(alphaPath, alpha);
		const rejected = spawnSync(process.execPath, [boundaryScript], {
			cwd: fixture,
			encoding: "utf8",
		});
		assert.equal(rejected.status, 1);
		assert.match(rejected.stderr, /must not reference @narumitw\/pi-beta/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("standalone typechecks build workspaces unless a verified build is ready", () => {
	const fixture = mkdtempSync(path.join(tmpdir(), "pi-typecheck-order-"));
	try {
		const tracePath = path.join(fixture, "trace.log");
		const fakeNpmPath = path.join(fixture, "fake-npm.mjs");
		writeFileSync(
			fakeNpmPath,
			`import fs from "node:fs";\nfs.appendFileSync(process.env.FAKE_CHECK_TRACE, process.argv.slice(2).join(" ") + "\\n");\n`,
		);
		const baseEnv = {
			...process.env,
			FAKE_CHECK_TRACE: tracePath,
			npm_execpath: fakeNpmPath,
			PI_EXTENSIONS_BUILD_READY: "",
		};

		const standalone = spawnSync(process.execPath, [runTypechecksScript], {
			cwd: repositoryRoot,
			encoding: "utf8",
			env: baseEnv,
		});
		assert.equal(standalone.status, 0, standalone.stderr);
		assert.deepEqual(readFileSync(tracePath, "utf8").trim().split("\n"), [
			"run build",
			"--workspaces run typecheck",
		]);

		writeFileSync(tracePath, "");
		const prebuilt = spawnSync(process.execPath, [runTypechecksScript], {
			cwd: repositoryRoot,
			encoding: "utf8",
			env: { ...baseEnv, PI_EXTENSIONS_BUILD_READY: "1" },
		});
		assert.equal(prebuilt.status, 0, prebuilt.stderr);
		assert.equal(readFileSync(tracePath, "utf8").trim(), "--workspaces run typecheck");
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("repository checks build before starting independent gates in parallel", () => {
	const result = runFakeChecks();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(traceEntries(result.trace, "start"), ["build", ...expectedChecks].sort());
	assert.deepEqual(traceEntries(result.trace, "finish"), ["build", ...expectedChecks].sort());
	assertBuildFinishedFirst(result.trace);
});

test("repository checks report a failing gate after all gates run", () => {
	const result = runFakeChecks("typecheck");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /typecheck failed/);
	assert.deepEqual(traceEntries(result.trace, "start"), ["build", ...expectedChecks].sort());
	assert.deepEqual(traceEntries(result.trace, "finish"), ["build", ...expectedChecks].sort());
	assertBuildFinishedFirst(result.trace);
});

test("repository checks stop before consumer gates when the prerequisite build fails", () => {
	const result = runFakeChecks("build");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /build failed/);
	assert.deepEqual(result.trace.trim().split("\n"), ["start:build", "finish:build"]);
});

function runFakeChecks(failingCheck = "") {
	const fixture = mkdtempSync(path.join(tmpdir(), "pi-checks-"));
	try {
		const tracePath = path.join(fixture, "trace.log");
		const fakeNpmPath = path.join(fixture, "fake-npm.mjs");
		writeFileSync(
			fakeNpmPath,
			`import fs from "node:fs";
const check = process.argv.at(-1);
const tracePath = process.env.FAKE_CHECK_TRACE;
fs.appendFileSync(tracePath, \`start:\${check}\\n\`);
if (check === "build") {
\tfs.appendFileSync(tracePath, \`finish:\${check}\\n\`);
\tif (check === process.env.FAKE_CHECK_FAILURE) process.exit(23);
\tprocess.exit(0);
}
if (process.env.PI_EXTENSIONS_BUILD_READY !== "1") process.exit(71);
const deadline = Date.now() + 2_000;
while (
\tfs
\t\t.readFileSync(tracePath, "utf8")
\t\t.split("\\n")
\t\t.filter((line) => line.startsWith("start:") && line !== "start:build").length !== 4
) {
\tif (Date.now() > deadline) process.exit(70);
\tawait new Promise((resolve) => setTimeout(resolve, 10));
}
fs.appendFileSync(tracePath, \`finish:\${check}\\n\`);
if (check === process.env.FAKE_CHECK_FAILURE) process.exit(23);
`,
		);

		const result = spawnSync(process.execPath, [checkScript], {
			cwd: repositoryRoot,
			encoding: "utf8",
			env: {
				...process.env,
				FAKE_CHECK_FAILURE: failingCheck,
				FAKE_CHECK_TRACE: tracePath,
				npm_execpath: fakeNpmPath,
			},
		});
		return {
			...result,
			trace: readFileSync(tracePath, "utf8"),
		};
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
}

function assertBuildFinishedFirst(trace: string) {
	const entries = trace.trim().split("\n");
	const buildFinished = entries.indexOf("finish:build");
	assert.notEqual(buildFinished, -1);
	for (const check of expectedChecks) {
		assert.ok(buildFinished < entries.indexOf(`start:${check}`));
	}
}

function traceEntries(trace: string, event: string) {
	return trace
		.split("\n")
		.filter((line) => line.startsWith(`${event}:`))
		.map((line) => line.slice(event.length + 1))
		.sort();
}

function writeLibraryFixture(fixture: string, directory: string, name: string) {
	writeJson(path.join(fixture, "packages", directory, "package.json"), {
		name,
		files: ["dist"],
		main: "./dist/index.js",
		types: "./dist/index.d.ts",
		scripts: { build: "tsc" },
	});
}

function writeExtensionFixture(
	fixture: string,
	directory: string,
	name: string,
	dependencies: Record<string, string>,
) {
	const root = path.join(fixture, "packages", directory);
	writeJson(path.join(root, "package.json"), {
		name,
		dependencies,
		pi: { extensions: ["./src/index.ts"] },
		piExtension: { lifecycle: "stable" },
	});
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "src/index.ts"), 'export { default } from "./extension.js";\n');
	writeFileSync(path.join(root, "src/extension.ts"), "export default function extension() {}\n");
}

function writeJson(filePath: string, value: unknown) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}
