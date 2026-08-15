import { EXTERNAL_ADAPTER_SCHEMA_VERSION, HOSTED_LLM_PROVIDERS } from '../models/HostedLlmProvider';
import {
    AI_BACKENDS,
    PROVIDER_PROTOCOL_OPERATIONS,
    PROVIDER_PROTOCOL_SCHEMA_VERSION,
} from '../models/LlmOrchestrationTypes';

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
            schemaVersion: PROVIDER_PROTOCOL_SCHEMA_VERSION,
            capabilities: ['provider-neutral-tool-calls', 'terminal-outcomes', 'stream-cancellation'] as const,
            operations: PROVIDER_PROTOCOL_OPERATIONS.map((name) => ({
                name,
                version: String(PROVIDER_PROTOCOL_SCHEMA_VERSION),
                availability: 'available' as const,
            })),
            availability: 'available' as const,
            compatibility: {
                mode: 'reject-unsupported' as const,
                behavior: 'Normalize supported provider responses and fail closed on unsupported terminal protocols.',
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
