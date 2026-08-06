import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];
const DOCUMENTATION_BASENAMES = new Set([
	"CHANGELOG.md",
	"LICENSE",
	"LICENSE.md",
	"NOTICES.md",
	"README.md",
]);
const ROOT_FULL_TEST_FILES = new Set([
	"package-lock.json",
	"package.json",
	"tsconfig.json",
	"tsconfig.test.json",
]);
const ROOT_IGNORED_PREFIXES = [".github/", "docs/"];

export function changedFilesSince(root, base, head = "HEAD") {
	if (!base || /^0+$/u.test(base)) throw new Error("the event has no usable base commit");

	const output = execFileSync(
		"git",
		["diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB", `${base}...${head}`],
		{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	return output.split("\0").filter(Boolean);
}

export function selectAffectedTests(root, changedFiles) {
	const workspaces = readWorkspaces(root);
	const workspaceByDirectory = new Map(
		workspaces.map((workspace) => [workspace.directoryName, workspace]),
	);
	const directlyAffected = new Set();
	let includeRootTests = false;
	let fullReason;

	for (const changedFile of changedFiles) {
		const normalized = changedFile.split(path.sep).join("/").replace(/^\.\//u, "");
		if (!normalized || normalized.startsWith("../")) {
			fullReason = `unsafe changed path: ${changedFile}`;
			break;
		}

		const packageMatch = /^packages\/([^/]+)(?:\/(.*))?$/u.exec(normalized);
		if (packageMatch) {
			const [, directoryName, relativePath = ""] = packageMatch;
			if (!isPackageTestRelevant(relativePath)) continue;

			const workspace = workspaceByDirectory.get(directoryName);
			if (!workspace) {
				fullReason = `changed package is not present in the current workspace: ${directoryName}`;
				break;
			}
			directlyAffected.add(workspace.name);
			includeRootTests = true;
			continue;
		}

		if (normalized.startsWith("test/") || normalized === ".changeset/config.json") {
			includeRootTests = true;
			continue;
		}

		if (ROOT_FULL_TEST_FILES.has(normalized) || normalized.startsWith("scripts/")) {
			fullReason = `shared test input changed: ${normalized}`;
			break;
		}

		if (isIgnoredRootFile(normalized)) continue;
		if (/\.(?:[cm]?[jt]sx?|json)$/u.test(normalized)) {
			fullReason = `unscoped code or configuration changed: ${normalized}`;
			break;
		}
	}

	if (fullReason) {
		return {
			mode: "full",
			includeRootTests: true,
			workspaceDirectories: workspaces.map(({ directoryName }) => directoryName),
			reason: fullReason,
		};
	}

	const affectedNames = expandReverseDependencies(workspaces, directlyAffected);
	const workspaceDirectories = workspaces
		.filter(({ name }) => affectedNames.has(name))
		.map(({ directoryName }) => directoryName);
	if (workspaceDirectories.length === 0 && !includeRootTests) {
		return {
			mode: "skip",
			includeRootTests: false,
			workspaceDirectories: [],
			reason: "no test-relevant files changed",
		};
	}

	return {
		mode: "affected",
		includeRootTests,
		workspaceDirectories,
		reason: `${directlyAffected.size} directly changed workspace(s), ${workspaceDirectories.length} affected workspace(s)`,
	};
}

function readWorkspaces(root) {
	const packagesDirectory = path.join(root, "packages");
	if (!fs.existsSync(packagesDirectory)) return [];

	const workspaces = [];
	for (const entry of fs.readdirSync(packagesDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = path.join(packagesDirectory, entry.name, "package.json");
		if (!fs.existsSync(manifestPath)) continue;
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		if (typeof manifest.name !== "string") continue;
		workspaces.push({
			dependencies: dependencyNames(manifest),
			directoryName: entry.name,
			name: manifest.name,
		});
	}
	return workspaces.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

function dependencyNames(manifest) {
	const names = new Set();
	for (const field of DEPENDENCY_FIELDS) {
		const dependencies = manifest[field];
		if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
		for (const name of Object.keys(dependencies)) names.add(name);
	}
	return names;
}

function expandReverseDependencies(workspaces, directlyAffected) {
	const affected = new Set(directlyAffected);
	let changed = true;
	while (changed) {
		changed = false;
		for (const workspace of workspaces) {
			if (affected.has(workspace.name)) continue;
			if (![...workspace.dependencies].some((dependency) => affected.has(dependency))) continue;
			affected.add(workspace.name);
			changed = true;
		}
	}
	return affected;
}

function isPackageTestRelevant(relativePath) {
	if (!relativePath) return true;
	if (DOCUMENTATION_BASENAMES.has(path.posix.basename(relativePath))) return false;
	return true;
}

function isIgnoredRootFile(filePath) {
	if (ROOT_IGNORED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return true;
	if (filePath.startsWith(".changeset/") && filePath !== ".changeset/config.json") return true;
	return DOCUMENTATION_BASENAMES.has(path.posix.basename(filePath));
}
