import { normalizeProviderCapabilityProbe } from './normalizeProviderCapabilityProbe';
import { probeProviderGatewaySession } from './probeProviderGatewaySession';
import { type CompiledProviderAdapter } from './providerAdapterRegistry';

const verifiedAdapters = new WeakSet<CompiledProviderAdapter>();

export async function ensureAdapterCapabilities(
    adapter: CompiledProviderAdapter,
    sessionId: string,
    signal: AbortSignal
): Promise<void> {
    if (verifiedAdapters.has(adapter)) {
        return;
    }
    const bytes = await probeProviderGatewaySession(sessionId, signal);
    let payload: unknown;
    try {
        payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw new Error('Provider adapter capability probe returned invalid JSON');
    }
    normalizeProviderCapabilityProbe(adapter, payload);
    verifiedAdapters.add(adapter);
}
