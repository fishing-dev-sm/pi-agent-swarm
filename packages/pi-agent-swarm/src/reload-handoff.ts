const RELOAD_HANDOFFS = Symbol.for("pi-agent-swarm/reload-handoffs");

export interface SwarmReloadHandoff {
  invite: string;
  acceptsRequests: boolean;
  launchId?: string;
  kickoffCapability?: string;
  kickoffConsumed: boolean;
  name?: string;
  color?: string;
  parentSessionId?: string;
  expiresAt: number;
}

export function putReloadHandoff(owner: object, handoff: SwarmReloadHandoff): void {
  reloadHandoffs().set(owner, handoff);
}

export function takeReloadHandoff(owner: object, now: number): SwarmReloadHandoff | undefined {
  const store = reloadHandoffs();
  const value = store.get(owner);
  store.delete(owner);
  return value && value.expiresAt >= now ? value : undefined;
}

function reloadHandoffs(): WeakMap<object, SwarmReloadHandoff> {
  const root = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = root[RELOAD_HANDOFFS];
  if (existing instanceof WeakMap) return existing as WeakMap<object, SwarmReloadHandoff>;
  const created = new WeakMap<object, SwarmReloadHandoff>();
  root[RELOAD_HANDOFFS] = created;
  return created;
}
