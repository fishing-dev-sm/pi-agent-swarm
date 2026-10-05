import { createInterface } from "node:readline";
import { consumeLaunchEnvelope } from "../src/launch-envelope.js";
import { parseInvite, SWARM_PROTOCOL_VERSION } from "../src/protocol.js";
import { SwarmTransport } from "../src/transport.js";

const baseDirectory = process.env.PI_SWARM_TEST_BASE;
delete process.env.PI_SWARM_TEST_BASE;
if (!baseDirectory) throw new Error("test runtime base is required");
const envelope = consumeLaunchEnvelope(process.env);
if (!envelope) throw new Error("launch envelope is required");
const transport = new SwarmTransport({
  group: parseInvite(envelope.invite),
  peer: {
    protocolVersion: SWARM_PROTOCOL_VERSION,
    sessionId: "child-process",
    name: envelope.childName,
    cwd: process.cwd(),
    pid: process.pid,
    launchId: envelope.launchId,
    acceptsRequests: envelope.acceptsRequests,
  },
  baseDirectory,
  kickoffCapability: envelope.kickoffCapability,
  onMessage: async (message) => {
    process.stdout.write(`${JSON.stringify({ type: "message", message })}\n`);
  },
});
await transport.start();
process.stdout.write(
  `${JSON.stringify({
    type: "ready",
    cwd: process.cwd(),
    launchId: envelope.launchId,
    environmentConsumed: process.env.PI_SWARM_INVITE === undefined,
  })}\n`,
);
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (line === "stop") break;
}
lines.close();
process.stdin.destroy();
await transport.stop();
