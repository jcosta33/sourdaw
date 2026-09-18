/**
 * Where capability discovery reads its catalog from.
 *
 * Capabilities are published by AiRuntime, which imports this module, so the
 * catalog arrives through a provider the composition root registers instead of
 * an import that would close a cycle. With no provider registered there is no
 * catalog to project, and discovery reports that rather than an empty one.
 */

type AgentCapabilityCatalogEntry = {
    id: string;
    name: string;
    availability: 'available' | 'unavailable';
    reason: string | null;
    version: string | null;
    evidence: Readonly<Record<string, unknown>>;
};

type AgentCapabilityCatalog = {
    version: string;
    entries: readonly AgentCapabilityCatalogEntry[];
};

type AgentCapabilityCatalogProvider = () => AgentCapabilityCatalog;

let provider: AgentCapabilityCatalogProvider | null = null;

export const agentCapabilityDiscoveryPort = {
    read(): AgentCapabilityCatalog | null {
        return provider?.() ?? null;
    },
    setProvider(nextProvider: AgentCapabilityCatalogProvider | null): void {
        provider = nextProvider;
    },
};
