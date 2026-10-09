import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isAutoNameModel } from "./auto-name.js";
import type { SwarmColorPaletteName } from "./color.js";

export const SWARM_SETTINGS_FILE = "pi-agent-swarm.json";
export const MAX_SWARM_SETTINGS_BYTES = 64 * 1024;
export const DEFAULT_SWARM_SETTINGS: Readonly<SwarmSettings> = Object.freeze({
  autoName: true,
  colorPalette: "muted",
  confirmSessionLaunch: true,
  externalCommand: "alacritty -e",
  pinToLeadWorkspace: false,
});

export interface SwarmSettings {
  autoName: boolean;
  autoNameModel?: string;
  colorPalette: SwarmColorPaletteName;
  confirmSessionLaunch: boolean;
  externalCommand: string;
  pinToLeadWorkspace: boolean;
}

export type SwarmSettingsField = keyof SwarmSettings;
export type SwarmSettingsSource = "built-in" | "user";
export type SwarmSettingsPatch = Partial<SwarmSettings>;

export interface NormalizedSwarmSettings {
  settings: SwarmSettings;
  sources: Record<SwarmSettingsField, SwarmSettingsSource>;
}

export interface SwarmSettingsIssue {
  kind: "invalid";
  message: string;
}

export interface SwarmSettingsState extends NormalizedSwarmSettings {
  issue?: SwarmSettingsIssue;
  canSave: boolean;
}

export type SwarmSettingsLoadResult =
  | (NormalizedSwarmSettings & {
      kind: "missing";
      path: string;
      document: Record<string, unknown>;
    })
  | (NormalizedSwarmSettings & {
      kind: "loaded";
      path: string;
      document: Record<string, unknown>;
    })
  | (NormalizedSwarmSettings & {
      kind: "invalid";
      path: string;
      issue: SwarmSettingsIssue;
    });

export interface SwarmSettingsOperations {
  writeFile: typeof writeFile;
  rename: typeof rename;
}

export interface SwarmSettingsRuntime {
  get(): Readonly<SwarmSettingsState>;
  getPath(): string;
  reload(signal?: AbortSignal): Promise<Readonly<SwarmSettingsState>>;
  update(patch: SwarmSettingsPatch): Promise<Readonly<SwarmSettingsState>>;
  flush(): Promise<void>;
}

export interface SwarmSettingsRuntimeOptions {
  path?: string | (() => string);
  operations?: Partial<SwarmSettingsOperations>;
}

const SETTING_FIELDS = [
  "autoName",
  "autoNameModel",
  "colorPalette",
  "confirmSessionLaunch",
  "externalCommand",
  "pinToLeadWorkspace",
] as const satisfies readonly SwarmSettingsField[];
const SETTING_FIELD_SET = new Set<string>(SETTING_FIELDS);

export function swarmSettingsFilePath(): string {
  return join(getAgentDir(), SWARM_SETTINGS_FILE);
}

export function normalizeSwarmSettingsDocument(value: unknown): NormalizedSwarmSettings | undefined {
  if (!isRecord(value)) return undefined;
  const settings: SwarmSettings = { ...DEFAULT_SWARM_SETTINGS };
  const sources = builtInSources();

  if (Object.hasOwn(value, "autoName")) {
    if (typeof value.autoName !== "boolean") return undefined;
    settings.autoName = value.autoName;
    sources.autoName = "user";
  }
  if (Object.hasOwn(value, "autoNameModel")) {
    if (typeof value.autoNameModel !== "string" || !isAutoNameModel(value.autoNameModel.trim())) {
      return undefined;
    }
    settings.autoNameModel = value.autoNameModel.trim();
    sources.autoNameModel = "user";
  }
  if (Object.hasOwn(value, "colorPalette")) {
    if (value.colorPalette !== "muted" && value.colorPalette !== "bright") return undefined;
    settings.colorPalette = value.colorPalette;
    sources.colorPalette = "user";
  }
  if (Object.hasOwn(value, "confirmSessionLaunch")) {
    if (typeof value.confirmSessionLaunch !== "boolean") return undefined;
    settings.confirmSessionLaunch = value.confirmSessionLaunch;
    sources.confirmSessionLaunch = "user";
  }
  if (Object.hasOwn(value, "externalCommand")) {
    if (typeof value.externalCommand !== "string" || value.externalCommand.trim().length === 0) {
      return undefined;
    }
    settings.externalCommand = value.externalCommand.trim();
    sources.externalCommand = "user";
  }
  if (Object.hasOwn(value, "pinToLeadWorkspace")) {
    if (typeof value.pinToLeadWorkspace !== "boolean") return undefined;
    settings.pinToLeadWorkspace = value.pinToLeadWorkspace;
    sources.pinToLeadWorkspace = "user";
  }
  return { settings, sources };
}

export async function loadSwarmSettings(
  path = swarmSettingsFilePath(),
  signal?: AbortSignal,
): Promise<SwarmSettingsLoadResult> {
  let text: string;
  try {
    text = await readSettingsDocument(path, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        kind: "missing",
        path,
        document: {},
        settings: { ...DEFAULT_SWARM_SETTINGS },
        sources: builtInSources(),
      };
    }
    return invalidLoad(path, formatError(error));
  }

  try {
    const document = JSON.parse(text) as unknown;
    const normalized = normalizeSwarmSettingsDocument(document);
    if (!normalized || !isRecord(document)) {
      return invalidLoad(path, "the document is malformed or contains an invalid setting");
    }
    return { kind: "loaded", path, document, ...normalized };
  } catch (error) {
    return invalidLoad(path, formatError(error));
  }
}

export function createInMemorySwarmSettingsRuntime(): SwarmSettingsRuntime {
  let state: SwarmSettingsState = {
    settings: { ...DEFAULT_SWARM_SETTINGS },
    sources: builtInSources(),
    canSave: true,
  };
  return {
    get: () => freezeState(state),
    getPath: () => "",
    reload: async () => freezeState(state),
    update: async (patch) => {
      const canonical = normalizePatch(patch);
      state = {
        settings: { ...state.settings, ...canonical },
        sources: {
          ...state.sources,
          ...(canonical.autoName !== undefined ? { autoName: "user" as const } : {}),
          ...(canonical.autoNameModel !== undefined ? { autoNameModel: "user" as const } : {}),
          ...(canonical.colorPalette !== undefined ? { colorPalette: "user" as const } : {}),
          ...(canonical.confirmSessionLaunch !== undefined ? { confirmSessionLaunch: "user" as const } : {}),
          ...(canonical.externalCommand ? { externalCommand: "user" as const } : {}),
          ...(canonical.pinToLeadWorkspace !== undefined ? { pinToLeadWorkspace: "user" as const } : {}),
        },
        canSave: true,
      };
      return freezeState(state);
    },
    flush: async () => undefined,
  };
}

export function createSwarmSettingsRuntime(options: SwarmSettingsRuntimeOptions = {}): SwarmSettingsRuntime {
  let resolvedPath: string | undefined;
  const getPath = () => {
    resolvedPath ??= typeof options.path === "function" ? options.path() : (options.path ?? swarmSettingsFilePath());
    return resolvedPath;
  };
  const operations: SwarmSettingsOperations = {
    writeFile,
    rename,
    ...options.operations,
  };
  let state: SwarmSettingsState = {
    settings: { ...DEFAULT_SWARM_SETTINGS },
    sources: builtInSources(),
    canSave: true,
  };
  let queue = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    get: () => freezeState(state),
    getPath,
    reload(signal) {
      return enqueue(async () => {
        const loaded = await loadSwarmSettings(getPath(), signal);
        if (loaded.kind === "invalid") {
          state = { ...state, issue: loaded.issue, canSave: false };
          return freezeState(state);
        }
        state = { settings: loaded.settings, sources: loaded.sources, canSave: true };
        return freezeState(state);
      });
    },
    update(patch) {
      return enqueue(async () => {
        const canonicalPatch = normalizePatch(patch);
        const latest = await loadSwarmSettings(getPath());
        if (latest.kind === "invalid") {
          state = { ...state, issue: latest.issue, canSave: false };
          throw new Error(`Cannot update malformed or invalid settings: ${latest.issue.message}`);
        }
        const document = { ...latest.document, ...canonicalPatch };
        const normalized = normalizeSwarmSettingsDocument(document);
        if (!normalized) throw new Error("Refusing to publish invalid Pi Agent Swarm settings.");
        await publishSettingsDocument(document, getPath(), operations);
        state = { ...normalized, canSave: true };
        return freezeState(state);
      });
    },
    async flush() {
      await queue;
    },
  };
}

function normalizePatch(patch: SwarmSettingsPatch): SwarmSettingsPatch {
  if (!isRecord(patch) || Object.keys(patch).some((key) => !SETTING_FIELD_SET.has(key))) {
    throw new Error("Refusing to update unknown Pi Agent Swarm settings.");
  }
  const normalized = normalizeSwarmSettingsDocument(patch);
  if (!normalized) throw new Error("Refusing to update invalid Pi Agent Swarm settings.");
  const canonical: SwarmSettingsPatch = {};
  for (const field of SETTING_FIELDS) {
    if (Object.hasOwn(patch, field)) assignSetting(canonical, field, normalized.settings[field]);
  }
  return canonical;
}

function assignSetting<K extends SwarmSettingsField>(
  settings: SwarmSettingsPatch,
  field: K,
  value: SwarmSettings[K],
): void {
  settings[field] = value;
}

async function publishSettingsDocument(
  document: Record<string, unknown>,
  path: string,
  operations: SwarmSettingsOperations,
): Promise<void> {
  const contents = `${JSON.stringify(document, null, "\t")}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_SWARM_SETTINGS_BYTES) {
    throw new Error(`settings document exceeds ${MAX_SWARM_SETTINGS_BYTES} bytes`);
  }
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await operations.writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await operations.rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readSettingsDocument(path: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags);
  try {
    throwIfAborted(signal);
    const [descriptorStats, pathStats] = await Promise.all([handle.stat(), lstat(path)]);
    throwIfAborted(signal);
    if (pathStats.isSymbolicLink()) throw new Error("symbolic links are not accepted");
    if (!descriptorStats.isFile() || !pathStats.isFile()) {
      throw new Error("settings path is not a regular file");
    }
    if (descriptorStats.dev !== pathStats.dev || descriptorStats.ino !== pathStats.ino) {
      throw new Error("settings path changed while it was being opened");
    }
    if (descriptorStats.size > MAX_SWARM_SETTINGS_BYTES) {
      throw new Error(`settings file exceeds ${MAX_SWARM_SETTINGS_BYTES} bytes`);
    }
    const buffer = Buffer.alloc(MAX_SWARM_SETTINGS_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      throwIfAborted(signal);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MAX_SWARM_SETTINGS_BYTES) {
      throw new Error(`settings file exceeds ${MAX_SWARM_SETTINGS_BYTES} bytes`);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new Error("settings file is not valid UTF-8");
    }
  } finally {
    await handle.close();
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

function invalidLoad(path: string, reason: string): SwarmSettingsLoadResult {
  return {
    kind: "invalid",
    path,
    settings: { ...DEFAULT_SWARM_SETTINGS },
    sources: builtInSources(),
    issue: { kind: "invalid", message: `${SWARM_SETTINGS_FILE} ignored (${path}: ${reason})` },
  };
}

function builtInSources(): Record<SwarmSettingsField, SwarmSettingsSource> {
  return {
    autoName: "built-in",
    autoNameModel: "built-in",
    colorPalette: "built-in",
    confirmSessionLaunch: "built-in",
    externalCommand: "built-in",
    pinToLeadWorkspace: "built-in",
  };
}

function freezeState(state: SwarmSettingsState): Readonly<SwarmSettingsState> {
  return Object.freeze({
    ...state,
    settings: Object.freeze({ ...state.settings }),
    sources: Object.freeze({ ...state.sources }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
