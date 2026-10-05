import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SwarmMessage } from "./protocol.js";
import { safeTerminalLine, safeTerminalText } from "./text.js";

export const SWARM_MESSAGE_TYPE = "pi-agent-swarm-message";

export interface SwarmMessageDetails {
  message: SwarmMessage;
}

export const renderSwarmMessage: MessageRenderer<SwarmMessageDetails> = (message, options, theme) => {
  const details = message.details;
  if (!details?.message) return undefined;
  const value = details.message;
  const sender = safeTerminalLine(value.fromName ?? value.fromSessionId) || "unknown session";
  const mode = value.mode === "request" || value.mode === "kickoff" ? "request" : value.mode;
  const lines = [theme.fg("accent", theme.bold(`Pi Agent Swarm ${mode} · ${sender}`)), safeTerminalText(value.text)];
  if (options.expanded) {
    lines.push(
      theme.fg("dim", `Session: ${safeTerminalLine(value.fromSessionId)}`),
      theme.fg("dim", `Cwd: ${safeTerminalLine(value.fromCwd ?? "unknown")}`),
      theme.fg("dim", `Message: ${safeTerminalLine(value.id)}`),
    );
    if (value.replyTo) {
      lines.push(theme.fg("dim", `Reply to: ${safeTerminalLine(value.replyTo)}`));
    }
  }
  return new Text(lines.join("\n"), options.outputPad, 0);
};
