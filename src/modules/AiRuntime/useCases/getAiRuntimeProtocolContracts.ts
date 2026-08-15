import { EXTERNAL_ADAPTER_SCHEMA_VERSION, HOSTED_LLM_PROVIDERS } from '../models/HostedLlmProvider';
import { AI_BACKENDS } from '../models/LlmOrchestrationTypes';
import { MODEL_PROVIDER_OPERATIONS, MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION } from '../models/ModelProviderProtocol';

import { getConfiguredCloudProvider } from './cloudApiManagement/getConfiguredCloudProvider';
import { isNativeAiRuntimeAvailable } from './llmOrchestration/backendResolution/isNativeAiRuntimeAvailable';

function getAdapterAvailability(name: string, configuredHostedProvider: string | undefined) {
    if (name === 'native') {
        return isNativeAiRuntimeAvailable() ? ('available' as const) : ('unavailable-on-platform' as const);
    }
    if (name === 'webllm') {
        return 'runtime-dependent' as const;
    }
    return configuredHostedProvider === name ? ('available' as const) : ('configuration-required' as const);
}

export function getAiRuntimeProtocolContracts() {
    const localAdapters = AI_BACKENDS.filter((backend) => backend === 'native' || backend === 'webllm');
    const adapters = [...localAdapters, ...HOSTED_LLM_PROVIDERS];
    const configuredHostedProvider = getConfiguredCloudProvider()?.provider;
    const adapterOperations = adapters.map((name) => ({
        name,
        version: String(EXTERNAL_ADAPTER_SCHEMA_VERSION),
        availability: getAdapterAvailability(name, configuredHostedProvider),
    }));

    return {
        providerProtocol: {
            id: 'provider-protocol' as const,
            owner: 'AiRuntime' as const,
            schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
            capabilities: [
                'provider-neutral-text-tools-and-structured-output',
                'delta-snapshot-and-final-events',
                'usage-provenance-and-reconciliation',
                'context-output-and-run-budgets',
                'cache-reasoning-and-data-policy-controls',
                'typed-retryability-safe-diagnostics-and-partial-output',
                'fixed-unavailable-media-modalities',
                'unknown-future-event-tolerance',
                'stream-cancellation',
            ] as const,
            operations: MODEL_PROVIDER_OPERATIONS.map((name) => ({
                name,
                version: String(MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION),
                availability: 'available' as const,
            })),
            availability: 'available' as const,
            compatibility: {
                mode: 'reject-unsupported' as const,
                behavior:
                    'Normalize supported provider requests and events, preserve unknown event names for diagnostics, and fail closed on unavailable capabilities.',
                canonicalProjectRequiresCommandReplay: false as const,
            },
        },
        externalAdapter: {
            id: 'external-adapter' as const,
            owner: 'AiRuntime' as const,
            schemaVersion: EXTERNAL_ADAPTER_SCHEMA_VERSION,
            capabilities: ['tool-planning', 'text-streaming', 'caller-owned-cancellation'] as const,
            operations: adapterOperations,
            availability: adapterOperations.some(({ availability }) => availability === 'available')
                ? ('available' as const)
                : ('runtime-dependent' as const),
            compatibility: {
                mode: 'reject-unsupported' as const,
                behavior:
                    'Keep provider-specific wire formats behind adapters and reject unsupported protocol versions.',
                canonicalProjectRequiresCommandReplay: false as const,
            },
        },
    };
}
