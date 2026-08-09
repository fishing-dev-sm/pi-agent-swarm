#!/usr/bin/env node

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getPackageDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const samples = parseSamples(process.argv.slice(2));
const cli = await resolvePiCli();
const benchmarkAgentDir = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-benchmark-agent-"));
const cleanupAgentDir = () => rmSync(benchmarkAgentDir, { recursive: true, force: true });
process.once("exit", cleanupAgentDir);
const fakePi = await writeFakePi(benchmarkAgentDir);
const fakeFreshSubprocessTurn = [];
const fakeRpcFirstTurn = [];
const fakeRpcRetainedFollowUp = [];
const freshRpcReadiness = [];
const retainedRpcCommand = [];
const inProcessCreate = [];
const retainedInProcessState = [];

for (let index = 0; index < samples; index++) {
	const subprocessStarted = performance.now();
	await runFakeSubprocessTurn(fakePi, benchmarkAgentDir);
	fakeFreshSubprocessTurn.push(performance.now() - subprocessStarted);
	const fakeClient = await startRpc(
		{ command: process.execPath, args: [fakePi] },
		benchmarkAgentDir,
	);
	let settled = fakeClient.waitFor("agent_settled");
	let turnStarted = performance.now();
	await fakeClient.request("prompt", { message: "first" });
	await settled;
	fakeRpcFirstTurn.push(performance.now() - turnStarted);
	settled = fakeClient.waitFor("agent_settled");
	turnStarted = performance.now();
	await fakeClient.request("prompt", { message: "follow-up" });
	await settled;
	fakeRpcRetainedFollowUp.push(performance.now() - turnStarted);
	await fakeClient.stop();
}

for (let index = 0; index < samples; index++) {
	const started = performance.now();
	const client = await startRpc(cli, benchmarkAgentDir);
	freshRpcReadiness.push(performance.now() - started);
	const retainedStarted = performance.now();
	await client.request("get_state");
	retainedRpcCommand.push(performance.now() - retainedStarted);
	await client.stop();
}

for (let index = 0; index < samples; index++) {
	const sdkStarted = performance.now();
	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		agentDir: benchmarkAgentDir,
		settingsManager: SettingsManager.inMemory({}),
		resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true },
	});
	const created = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
	});
	inProcessCreate.push(performance.now() - sdkStarted);
	const stateStarted = performance.now();
	void created.session.model;
	void created.session.thinkingLevel;
	retainedInProcessState.push(performance.now() - stateStarted);
	created.session.dispose();
}

process.stdout.write(
	`${JSON.stringify(
		{
			benchmark: "pi-subagents-transport-overhead:v1",
			samples,
			note: "Deterministic fake-turn and isolated real Pi startup/readiness overhead only; no provider request is made.",
			fakeFreshSubprocessTurnMs: stats(fakeFreshSubprocessTurn),
			fakeRpcFirstTurnMs: stats(fakeRpcFirstTurn),
			fakeRpcRetainedFollowUpMs: stats(fakeRpcRetainedFollowUp),
			freshRpcReadinessMs: stats(freshRpcReadiness),
			retainedRpcCommandMs: stats(retainedRpcCommand),
			inProcessSessionCreateMs: stats(inProcessCreate),
			retainedInProcessStateReadMs: stats(retainedInProcessState),
		},
		null,
		2,
	)}\n`,
);
process.off("exit", cleanupAgentDir);
cleanupAgentDir();

function parseSamples(args) {
	const index = args.indexOf("--samples");
	const raw = index >= 0 ? args[index + 1] : "7";
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
		throw new Error("--samples must be an integer between 1 and 100");
	}
	return value;
}

async function resolvePiCli() {
	const packageDir = getPackageDir();
	const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
	const declared = manifest?.bin?.pi;
	if (typeof declared !== "string" || !declared) throw new Error("Pi package has no bin.pi");
	return { command: process.execPath, args: [path.resolve(packageDir, declared)] };
}

async function writeFakePi(directory) {
	const filePath = path.join(directory, "fake-pi.mjs");
	await writeFile(
		filePath,
		[
			'import readline from "node:readline";',
			"const mode=process.argv[process.argv.indexOf('--mode')+1];",
			"const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');",
			"if(mode==='json'){send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}]}});process.exit(0);}",
			"const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});",
			"input.on('line',line=>{const command=JSON.parse(line);",
			"if(command.type==='get_state'){send({id:command.id,type:'response',command:'get_state',success:true,data:{model:{provider:'fake',id:'model'},thinkingLevel:'low',sessionId:'fake'}});return;}",
			"if(command.type==='prompt'){send({id:command.id,type:'response',command:'prompt',success:true});send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}]}});send({type:'agent_settled'});return;}",
			"});",
		].join(""),
		{ mode: 0o700 },
	);
	return filePath;
}

async function runFakeSubprocessTurn(fakePi, agentDir) {
	const proc = spawn(
		process.execPath,
		[fakePi, "--mode", "json", "-p", "--no-session", "benchmark"],
		{
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		},
	);
	let stderr = "";
	proc.stderr.on("data", (chunk) => {
		stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16 * 1024);
	});
	await new Promise((resolve, reject) => {
		proc.once("error", reject);
		proc.once("close", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`Fake subprocess failed (code=${code}, signal=${signal}): ${stderr}`));
		});
	});
}

async function startRpc(invocation, agentDir) {
	const proc = spawn(
		invocation.command,
		[
			...invocation.args,
			"--mode",
			"rpc",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--no-approve",
		],
		{
			cwd: process.cwd(),
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		},
	);
	let buffer = "";
	let nextId = 0;
	const pending = new Map();
	const eventWaiters = new Map();
	let stderr = "";
	let closed = false;
	proc.stdout.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			let line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line) continue;
			const value = JSON.parse(line);
			if (value.type === "response" && typeof value.id === "string") {
				const request = pending.get(value.id);
				if (request) {
					pending.delete(value.id);
					value.success ? request.resolve(value) : request.reject(new Error(value.error));
				}
			} else if (typeof value.type === "string") {
				const waiters = eventWaiters.get(value.type);
				const waiter = waiters?.shift();
				if (waiter) waiter.resolve(value);
				if (waiters?.length === 0) eventWaiters.delete(value.type);
			}
		}
	});
	proc.stderr.on("data", (chunk) => {
		stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16 * 1024);
	});
	const rejectPending = (error) => {
		for (const request of pending.values()) request.reject(error);
		pending.clear();
		for (const waiters of eventWaiters.values()) {
			for (const waiter of waiters) waiter.reject(error);
		}
		eventWaiters.clear();
	};
	proc.once("error", (error) => rejectPending(error));
	proc.once("close", (code, signal) => {
		closed = true;
		rejectPending(
			new Error(
				`RPC benchmark process exited (code=${code ?? "null"}, signal=${signal ?? "null"}): ${stderr}`,
			),
		);
	});
	const request = (type, payload = {}) =>
		new Promise((resolve, reject) => {
			const id = `benchmark_${++nextId}`;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`RPC ${type} timed out: ${stderr}`));
			}, 30_000);
			pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			proc.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`);
		});
	const waitFor = (type) =>
		new Promise((resolve, reject) => {
			const waiters = eventWaiters.get(type) ?? [];
			let entry;
			const timer = setTimeout(() => {
				const remaining = (eventWaiters.get(type) ?? []).filter((value) => value !== entry);
				if (remaining.length > 0) eventWaiters.set(type, remaining);
				else eventWaiters.delete(type);
				reject(new Error(`RPC ${type} event timed out: ${stderr}`));
			}, 30_000);
			entry = {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
			waiters.push(entry);
			eventWaiters.set(type, waiters);
		});
	const signalGroup = (signal) => {
		if (process.platform !== "win32" && proc.pid) {
			try {
				process.kill(-proc.pid, signal);
				return;
			} catch {
				// Fall back to the immediate process below.
			}
		}
		try {
			proc.kill(signal);
		} catch {
			// The process may already be closed.
		}
	};
	const stop = async () => {
		if (closed) return;
		proc.stdin.end();
		signalGroup("SIGTERM");
		const escalation = setTimeout(() => {
			if (!closed) signalGroup("SIGKILL");
		}, 1_000);
		try {
			await new Promise((resolve) => {
				if (closed) resolve();
				else proc.once("close", resolve);
			});
		} finally {
			clearTimeout(escalation);
		}
	};
	try {
		await request("get_state");
		return { request, waitFor, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

function stats(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const median = quantile(sorted, 0.5);
	const deviations = sorted
		.map((value) => Math.abs(value - median))
		.sort((left, right) => left - right);
	return {
		median: round(median),
		mad: round(quantile(deviations, 0.5)),
		min: round(sorted[0]),
		max: round(sorted.at(-1)),
	};
}

function quantile(sorted, value) {
	const index = (sorted.length - 1) * value;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function round(value) {
	return Number(value.toFixed(3));
}
