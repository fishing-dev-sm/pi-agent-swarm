#!/usr/bin/env node

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_RUNS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const SCENARIOS = ["import", "actions", "review", "task"];

const options = parseArguments(process.argv.slice(2));
if (options.worker) {
	await runWorker(options.worker);
} else if (options.help) {
	printHelp();
} else {
	const warmup = {};
	const measurements = {};
	for (const scenario of SCENARIOS) {
		warmup[scenario] = await measure(scenario, options.timeoutMs);
		measurements[scenario] = [];
		for (let index = 0; index < options.runs; index += 1) {
			measurements[scenario].push(await measure(scenario, options.timeoutMs));
		}
	}
	const summary = Object.fromEntries(
		SCENARIOS.map((scenario) => [
			scenario,
			{
				importMs: summarize(measurements[scenario].map((result) => result.importMs)),
				firstFrameMs: summarize(
					measurements[scenario]
						.map((result) => result.firstFrameMs)
						.filter((value) => value !== undefined),
				),
				codingAgentLoaded: measurements[scenario].some((result) => result.codingAgentLoaded),
			},
		]),
	);
	process.stdout.write(
		`${JSON.stringify(
			{
				protocolVersion: 1,
				measuredAt: new Date().toISOString(),
				node: process.version,
				cwd: process.cwd(),
				runs: options.runs,
				warmup,
				measurements,
				summary,
			},
			null,
			2,
		)}\n`,
	);
}

async function runWorker(scenario) {
	if (!SCENARIOS.includes(scenario)) fail(`Unknown worker scenario: ${scenario}`);
	const loadedUrls = [];
	const { registerHooks } = await import("node:module");
	registerHooks({
		resolve(specifier, context, nextResolve) {
			const result = nextResolve(specifier, context);
			loadedUrls.push(result.url);
			return result;
		},
	});

	const startedAt = performance.now();
	const kit = await import("@narumitw/pi-tui-kit");
	const importMs = performance.now() - startedAt;
	const kitLoadedCodingAgent = loadedUrls.some((url) =>
		url.includes("/@earendil-works/pi-coding-agent/"),
	);
	if (kitLoadedCodingAgent) {
		const { initTheme } = await import("@earendil-works/pi-coding-agent");
		initTheme("dark", false);
	}
	let firstFrameMs;
	if (scenario === "actions") {
		firstFrameMs = await runMenuFrame(kit, startedAt, {
			kind: "actions",
			title: "Benchmark actions",
			items: [{ id: "close", label: "Close", close: true }],
			hint: "close",
		});
	} else if (scenario === "review") {
		firstFrameMs = await runMenuFrame(kit, startedAt, {
			kind: "review",
			title: "Benchmark review",
			content: "const answer: number = 42;",
			format: { kind: "code", filePath: "benchmark.ts" },
			hint: "close",
		});
	} else if (scenario === "task") {
		const context = benchmarkContext(
			(elapsed) => {
				firstFrameMs ??= elapsed;
			},
			startedAt,
			false,
		);
		const result = await kit.runTask(context, {
			label: "Benchmark task",
			task: async () => "done",
		});
		if (result.kind !== "completed") {
			throw new Error(
				`Unexpected task result: ${result.kind}${result.kind === "error" ? `: ${result.error?.stack ?? result.error}` : ""}`,
			);
		}
	}

	const packageUrls = [...new Set(loadedUrls)]
		.filter((url) => /\/(?:node_modules|packages)\//u.test(url))
		.sort();
	process.stdout.write(
		`${JSON.stringify({
			scenario,
			importMs: round(importMs),
			firstFrameMs: firstFrameMs === undefined ? undefined : round(firstFrameMs),
			codingAgentLoaded: packageUrls.some((url) =>
				url.includes("/@earendil-works/pi-coding-agent/"),
			),
			packageUrls,
		})}\n`,
	);
}

async function runMenuFrame(kit, startedAt, screen) {
	let firstFrameMs;
	const context = benchmarkContext((elapsed) => {
		firstFrameMs ??= elapsed;
	}, startedAt);
	const menu = kit.defineMenu({
		start: "main",
		screens: { main: () => screen },
		actions: { unused: async () => ({ kind: "close" }) },
	});
	const result = await kit.runMenu(context, menu, { getState: () => undefined });
	if (result.kind !== "closed") throw new Error(`Unexpected menu result: ${result.kind}`);
	if (firstFrameMs === undefined) throw new Error("Menu did not render a frame");
	return firstFrameMs;
}

function benchmarkContext(onFirstFrame, startedAt, closeAfterFirstFrame = true) {
	const theme = {
		fg: (_color, text) => text,
		bold: (text) => text,
		italic: (text) => text,
		underline: (text) => text,
	};
	const keybindings = {
		matches(data, binding) {
			return binding === "tui.select.cancel" && data === "\u001b";
		},
		getKeys(binding) {
			return binding === "tui.select.cancel" ? ["escape", "ctrl+c"] : [];
		},
	};
	const tui = { terminal: { rows: 24 }, requestRender() {} };
	return {
		mode: "tui",
		hasUI: true,
		ui: {
			theme,
			notify() {},
			async custom(factory) {
				let resolveResult;
				const resultPromise = new Promise((resolve) => {
					resolveResult = resolve;
				});
				const component = factory(tui, theme, keybindings, resolveResult);
				component.render(80);
				onFirstFrame(performance.now() - startedAt);
				if (closeAfterFirstFrame) resolveResult(undefined);
				const result = await resultPromise;
				component.dispose?.();
				return result;
			},
		},
	};
}

async function measure(scenario, timeoutMs) {
	const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", scenario], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
	const exit = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	clearTimeout(timeout);
	if (exit.code !== 0) {
		throw new Error(
			`Benchmark worker failed (scenario=${scenario}, code=${exit.code}, signal=${exit.signal ?? "none"}).\n${stderr}\n${stdout}`,
		);
	}
	return JSON.parse(stdout.trim());
}

function summarize(values) {
	if (values.length === 0) return undefined;
	const center = median(values);
	return {
		median: round(center),
		medianAbsoluteDeviation: round(median(values.map((value) => Math.abs(value - center)))),
		min: round(Math.min(...values)),
		max: round(Math.max(...values)),
	};
}

function median(values) {
	const ordered = [...values].sort((left, right) => left - right);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 === 0
		? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
		: (ordered[middle] ?? 0);
}

function round(value) {
	return Math.round(value * 100) / 100;
}

function parseArguments(args) {
	const parsed = {
		help: false,
		runs: DEFAULT_RUNS,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		worker: undefined,
	};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--help" || argument === "-h") parsed.help = true;
		else if (argument === "--runs") {
			parsed.runs = positiveInteger(requireValue(args, ++index, argument), argument);
		} else if (argument === "--timeout-ms") {
			parsed.timeoutMs = positiveInteger(requireValue(args, ++index, argument), argument);
		} else if (argument === "--worker") parsed.worker = requireValue(args, ++index, argument);
		else fail(`Unknown argument: ${argument}`);
	}
	return parsed;
}

function requireValue(args, index, option) {
	const value = args[index];
	if (!value) fail(`${option} requires a value.`);
	return value;
}

function positiveInteger(value, option) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) fail(`${option} must be a positive integer.`);
	return number;
}

function printHelp() {
	process.stdout.write("Usage: node scripts/benchmark-tui-kit-runtime.mjs [options]\n\n");
	process.stdout.write(
		`  --runs <count>       Measured runs after warm-up (default: ${DEFAULT_RUNS})\n`,
	);
	process.stdout.write(
		`  --timeout-ms <n>     Per-worker timeout (default: ${DEFAULT_TIMEOUT_MS})\n`,
	);
}

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(2);
}
