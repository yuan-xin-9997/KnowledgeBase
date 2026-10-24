import type { Connector } from "./types.js";

/**
 * Placeholder connector registry. The concrete adapters are implemented in
 * local.ts / smb.ts / cubox.ts / yuque.ts by the connector module.
 */
const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  registry.set(connector.type, connector);
}

export function getConnector(type: string): Connector | undefined {
  return registry.get(type);
}

export function listConnectors(): Connector[] {
  return [...registry.values()];
}

export async function loadConnectors(): Promise<void> {
  const modules = await Promise.all([
    import("./local.js"),
    import("./smb.js"),
    import("./cubox.js"),
    import("./yuque.js"),
  ]);
  for (const module of modules) {
    if (module.default) registerConnector(module.default);
  }
}
