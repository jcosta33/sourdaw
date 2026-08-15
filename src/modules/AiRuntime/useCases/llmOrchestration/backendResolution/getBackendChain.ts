import { type AiBackendPreference, type RunnableAiBackend } from '../../../models/LlmOrchestrationTypes';
import {
    type ModelProviderModality,
    type ModelProviderName,
    type ModelProviderOperation,
} from '../../../models/ModelProviderProtocol';
import { getCloudProviderInfo } from '../../../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../../../repositories/cloudLlm/isCloudAvailable';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { createModelProviderProtocol } from '../../modelProviderProtocol';
import { resolveModelRoute } from '../../resolveModelRoute';

import { isNativeAiRuntimeAvailable } from './isNativeAiRuntimeAvailable';

const BACKEND_ORDERS: Record<AiBackendPreference, readonly RunnableAiBackend[]> = {
    auto: ['native', 'webllm', 'cloud'],
    native: ['native', 'webllm', 'cloud'],
    webllm: ['webllm', 'native', 'cloud'],
    cloud: ['cloud', 'native', 'webllm'],
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

function isBackendAvailable(backend: RunnableAiBackend): boolean {
    if (backend === 'native') {
        return isNativeAiRuntimeAvailable();
    }
    if (backend === 'webllm') {
        return typeof navigator !== 'undefined' && 'gpu' in navigator;
    }
    return isCloudAvailable();
}

function getPlatformEvidence(backend: RunnableAiBackend, available: boolean): string | null {
    if (!available) {
        return null;
    }
    if (backend === 'native') {
        return 'native-runtime';
    }
    if (backend === 'webllm') {
        return 'webgpu';
    }
    return 'configured-provider';
}

function getProviderIdentity(backend: RunnableAiBackend): { provider: ModelProviderName; modelId: string } {
    if (backend === 'native' || backend === 'webllm') {
        return { provider: backend, modelId: backend };
    }
    const providerInfo = getCloudProviderInfo();
    return {
        provider: providerInfo?.provider ?? 'openai-compatible',
        modelId: providerInfo?.model ?? 'cloud',
    };
}

function getProtocolFamily(provider: ModelProviderName): string {
    if (provider === 'native') {
        return 'native-local';
    }
    if (provider === 'anthropic') {
        return 'anthropic-messages';
    }
    return 'openai-chat-completions';
}

function createRouteCandidate(
    backend: RunnableAiBackend
): Parameters<typeof resolveModelRoute>[0]['candidates'][number] {
    const available = isBackendAvailable(backend);
    const readyBackend = llmStatusStore.value?.state === 'ready' ? llmStatusStore.value.backend : null;
    const identity = getProviderIdentity(backend);
    const providerCapabilities = createModelProviderProtocol({
        provider: identity.provider,
        model: identity.modelId,
    }).capabilities;
    const operations: ModelProviderOperation[] = [];
    if (providerCapabilities.text) {
        operations.push('text');
    }
    if (providerCapabilities.tools) {
        operations.push('tools');
    }
    if (providerCapabilities.structuredOutput) {
        operations.push('structured-output');
    }
    const modalities: ModelProviderModality[] = ['text'];
    for (const modality of ['audio', 'image', 'video'] as const) {
        if (providerCapabilities.media[modality] === 'available') {
            modalities.push(modality);
        }
    }
    return {
        routeId: backend,
        executor: backend,
        providerId: identity.provider,
        modelId:
            llmStatusStore.value?.state === 'ready' && llmStatusStore.value.backend === backend
                ? llmStatusStore.value.modelId
                : identity.modelId,
        protocolFamily: getProtocolFamily(identity.provider),
        capabilities: {
            operations,
            modalities,
            streaming: providerCapabilities.streaming,
        },
        trust: backend === 'cloud' ? 'configured-remote' : 'release-owned-local',
        dataClass: backend === 'cloud' ? 'remote-export' : 'local-private',
        cost: backend === 'cloud' ? 'paid' : 'local',
        platform: {
            available,
            evidence: getPlatformEvidence(backend, available),
        },
        modelInstalled: backend === 'cloud' ? available : readyBackend === backend,
        health: available ? 'healthy' : 'unavailable',
    };
}

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
