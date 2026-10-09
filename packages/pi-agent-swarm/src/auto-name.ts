import { type Api, type AssistantMessage, contentText, type Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { safeTerminalLine } from "./text.js";

/** Prefix applied to auto-generated session names, replacing the MANAGER-<id> default. */
export const AUTO_NAME_PREFIX = "MAN-";
/** Auto-naming runs once, after this many completed turns. */
export const AUTO_NAME_TURN_THRESHOLD = 3;
/** Maximum length of the generated title (the part after `MAN-`), in Unicode code points. */
export const AUTO_NAME_MAX_TITLE_CHARS = 24;
/** Per-message and total caps on the conversation excerpt sent to the title model. */
export const AUTO_NAME_MAX_MESSAGE_CHARS = 500;
export const AUTO_NAME_MAX_CONTEXT_CHARS = 2_000;
/** Wall-clock budget for the one-shot title completion. */
export const AUTO_NAME_TIMEOUT_MS = 120_000;

/** Maximum title-completion attempts per session before auto-naming gives up. */
export const AUTO_NAME_MAX_ATTEMPTS = 3;

// Matches exactly what sessionStart generates: `MANAGER-` plus the first 8
// characters of the session id. Session ids are not guaranteed to be hex (UUIDs
// can put a hyphen inside the first 8 characters), so accept any non-space run.
const DEFAULT_MANAGER_NAME_PATTERN = /^MANAGER-\S{8}$/u;
const AUTO_NAME_MODEL_PATTERN = /^[^\s/]+\/[^\s/]+$/u;

/** The default name assigned to human-started sessions before auto-naming kicks in. */
export function isDefaultManagerName(name: string | undefined): boolean {
  return name !== undefined && DEFAULT_MANAGER_NAME_PATTERN.test(name);
}

/** Validate the `provider/id` shape accepted by the `autoNameModel` setting. */
export function isAutoNameModel(value: string): boolean {
  return AUTO_NAME_MODEL_PATTERN.test(value);
}

/**
 * Turn raw model output into a `MAN-<title>` session name. Strips terminal
 * controls, quotes, and markdown noise, keeps the first line, truncates to
 * AUTO_NAME_MAX_TITLE_CHARS code points, and returns undefined when nothing
 * usable remains. 24 CJK characters stay well under the 200-byte name budget.
 */
export function toAutoName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const line = safeTerminalLine(raw)
    .replace(/^[\s"'`“”‘’#>*_~-]+/u, "")
    .replace(/[\s"'`“”‘’.,;:!?。，；：！？…·#>*_~-]+$/u, "")
    .trim();
  if (!line) return undefined;
  const title = [...line].slice(0, AUTO_NAME_MAX_TITLE_CHARS).join("");
  return `${AUTO_NAME_PREFIX}${title}`;
}

/**
 * Collect the first AUTO_NAME_TURN_THRESHOLD user messages from the current
 * branch, each clipped to AUTO_NAME_MAX_MESSAGE_CHARS and capped in total.
 */
export function collectAutoNameMessages(ctx: ExtensionContext): string[] {
  const messages: string[] = [];
  let total = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (messages.length >= AUTO_NAME_TURN_THRESHOLD || total >= AUTO_NAME_MAX_CONTEXT_CHARS) break;
    if (entry.type !== "message") continue;
    const message = (entry as { message?: unknown }).message;
    if (!isRecord(message) || message.role !== "user") continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string" && !Array.isArray(content)) continue;
    const text = safeTerminalLine(contentText(content as Parameters<typeof contentText>[0]));
    if (!text) continue;
    const clipped = [...text].slice(0, AUTO_NAME_MAX_MESSAGE_CHARS).join("");
    messages.push(clipped);
    total += clipped.length;
  }
  return messages;
}

/** Prompt asking the model for a bare, short session title in the user's language. */
export function buildAutoNamePrompt(messages: readonly string[]): string {
  return [
    "Summarize the user's goal in this conversation as a short session title.",
    "",
    "Rules:",
    "- Reply with only the title: no quotes, no prefix, no trailing punctuation.",
    "- Use the same language as the user messages.",
    `- Keep it under ${AUTO_NAME_MAX_TITLE_CHARS} characters.`,
    '- Name the task or topic, for example "修复登录页样式" or "Add payments API retry".',
    "",
    "User messages:",
    ...messages.map((message, index) => `${index + 1}. ${message}`),
  ].join("\n");
}

/**
 * Resolve the model used for the title completion: the configured
 * `provider/id` override when set, otherwise the session's current model.
 * Returns undefined when the override cannot be resolved.
 */
export function resolveAutoNameModel(ctx: ExtensionContext, configured: string | undefined): Model<Api> | undefined {
  if (!configured) return ctx.model;
  const slash = configured.indexOf("/");
  return ctx.modelRegistry.find(configured.slice(0, slash), configured.slice(slash + 1));
}

/** Default one-shot title completion through the session's model registry. */
export async function completeSessionTitle(
  ctx: ExtensionContext,
  model: Model<Api>,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const message: AssistantMessage = await ctx.modelRegistry.complete(
    model,
    { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
    { signal },
  );
  return contentText(message.content);
}

/**
 * Per-session state machine for auto-name attempts. The controller feeds
 * completed turns and external name changes in; the namer fires on the
 * AUTO_NAME_TURN_THRESHOLD-th turn while the session still carries its
 * default manager name and the user has not taken over naming. A failed
 * attempt is retried on later turns, up to AUTO_NAME_MAX_ATTEMPTS attempts,
 * because local single-threaded models can queue or drop one request.
 */
export class AutoNamer {
  private turnsSeen = 0;
  private attempts = 0;
  private userNamed = false;

  reset(): void {
    this.turnsSeen = 0;
    this.attempts = 0;
    this.userNamed = false;
  }

  /**
   * Record a name change produced outside the auto-namer. A default manager
   * name is the extension's own bootstrap and ignored; anything else means the
   * user (or a handoff) owns the name and auto-naming stays out of the way.
   */
  noteExternalName(name: string | undefined): void {
    if (isDefaultManagerName(name)) return;
    this.userNamed = true;
  }

  /**
   * Count one completed turn and report whether an auto-name attempt should
   * start now. Each returned true consumes one attempt; after a successful
   * naming the session no longer carries the default name, so later turns
   * permanently settle via the userNamed path.
   */
  noteTurn(currentName: string | undefined, enabled: boolean): boolean {
    if (this.userNamed) return false;
    this.turnsSeen += 1;
    if (this.turnsSeen < AUTO_NAME_TURN_THRESHOLD) return false;
    if (currentName !== undefined && !isDefaultManagerName(currentName)) {
      this.userNamed = true;
      return false;
    }
    if (!enabled || this.attempts >= AUTO_NAME_MAX_ATTEMPTS) return false;
    this.attempts += 1;
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
