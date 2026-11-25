/**
 * Where capability discovery reads its catalog from.
 *
 * Capabilities are published by AiRuntime, which imports this module, so the
 * catalog arrives through a provider the composition root registers instead of
 * an import that would close a cycle. Reading before registration throws: an
 * empty or absent catalog would tell an agent no capability exists.
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

let registeredProvider: AgentCapabilityCatalogProvider | null = null;

export const agentCapabilityDiscoveryPort = {
    read(): AgentCapabilityCatalog {
        if (registeredProvider === null) {
            throw new Error(
                'agentCapabilityDiscoveryPort.read: the capability catalog is not registered; call agentCapabilityDiscoveryPort.setProvider() from #/app/bootstrap (bootstrap does this)'
            );
        }
        return registeredProvider();
    },
    setProvider(nextProvider: AgentCapabilityCatalogProvider): void {
        registeredProvider = nextProvider;
    },
};
