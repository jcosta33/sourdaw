import { type ModelProviderCapabilities } from '../models/ModelProviderProtocol';

import { type CompiledProviderAdapter } from './providerAdapterRegistry';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeProviderCapabilityProbe(
    adapter: CompiledProviderAdapter,
    payload: unknown
): ModelProviderCapabilities {
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
        throw new Error('Provider adapter capability probe returned an invalid envelope');
    }
    const modelAvailable = payload.data.some(
        (entry) => isRecord(entry) && typeof entry.id === 'string' && entry.id === adapter.modelId
    );
    if (!modelAvailable) {
        throw new Error('Provider adapter capability probe did not advertise the configured model');
    }
    return adapter.capabilities;
}
