import { type AiBackendPreference, type RunnableAiBackend } from '../../../models/LlmOrchestrationTypes';
import { type ModelProviderModality, type ModelProviderOperation } from '../../../models/ModelProviderProtocol';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { resolveModelRoute } from '../../resolveModelRoute';

import { createRouteCandidate } from './createRouteCandidate';

const BACKEND_ORDERS: Record<AiBackendPreference, readonly RunnableAiBackend[]> = {
    auto: ['webllm', 'cloud'],
    webllm: ['webllm', 'cloud'],
    cloud: ['cloud', 'webllm'],
};

type BackendChainRequirements = {
    operation?: ModelProviderOperation;
    modality?: ModelProviderModality;
    streaming?: boolean;
    allowedTrust?: readonly ('release-owned-local' | 'configured-remote')[];
    dataPolicy?: 'local-only' | 'remote-allowed';
    costPolicy?: 'local-only' | 'allow-free-remote' | 'allow-paid-remote';
    requireInstalledModel?: boolean;
};

/**
 * Returns the ordered fallback chain for inference.
 * Used by provider-neutral structured tool planning.
 */
export function getBackendChain(requirements: BackendChainRequirements = {}): RunnableAiBackend[] {
    const preference = aiBackendPreferenceStore.value ?? 'auto';
    const permitsRemoteExecution = preference === 'cloud';
    const readyBackend = llmStatusStore.value?.state === 'ready' ? llmStatusStore.value.backend : null;
    const orderedBackends =
        preference !== 'auto' || readyBackend === null
            ? BACKEND_ORDERS.auto
            : [readyBackend, ...BACKEND_ORDERS.auto.filter((backend) => backend !== readyBackend)];
    const resolution = resolveModelRoute({
        requestedRoute: preference,
        requirements: {
            operation: requirements.operation ?? 'text',
            modality: requirements.modality ?? 'text',
            streaming: requirements.streaming ?? false,
            allowedTrust:
                requirements.allowedTrust ?? (permitsRemoteExecution ? ['configured-remote'] : ['release-owned-local']),
            dataPolicy: requirements.dataPolicy ?? (permitsRemoteExecution ? 'remote-allowed' : 'local-only'),
            costPolicy: requirements.costPolicy ?? (permitsRemoteExecution ? 'allow-paid-remote' : 'local-only'),
            requireInstalledModel: requirements.requireInstalledModel ?? false,
        },
        candidates: orderedBackends.map(createRouteCandidate),
    });
    return resolution.status === 'ready' ? resolution.routes.map((route) => route.executor) : [];
}
