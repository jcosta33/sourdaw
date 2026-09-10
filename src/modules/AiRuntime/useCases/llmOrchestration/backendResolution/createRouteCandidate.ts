import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { isWebGpuAvailable } from '#/modules/BrowserAi/stores';

import { type RunnableAiBackend } from '../../../models/LlmOrchestrationTypes';
import {
    type ModelProviderModality,
    type ModelProviderName,
    type ModelProviderOperation,
} from '../../../models/ModelProviderProtocol';
import { getCloudProviderInfo } from '../../../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../../../repositories/cloudLlm/isCloudAvailable';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { createModelProviderProtocol } from '../../modelProviderProtocol';
import { type ModelRouteCandidate } from '../../resolveModelRoute';

function isBackendAvailable(backend: RunnableAiBackend): boolean {
    if (backend === 'webllm') {
        return MODEL_RELEASE_ADMISSION.webLlm && isWebGpuAvailable();
    }
    return isCloudAvailable();
}

function getPlatformEvidence(backend: RunnableAiBackend, available: boolean): string | null {
    if (!available) {
        return null;
    }
    if (backend === 'webllm') {
        return 'webgpu';
    }
    return 'configured-provider';
}

function getProviderIdentity(backend: RunnableAiBackend): { provider: ModelProviderName; modelId: string } {
    if (backend === 'webllm') {
        return { provider: backend, modelId: backend };
    }
    const providerInfo = getCloudProviderInfo();
    return {
        provider: providerInfo?.provider ?? 'openai-compatible',
        modelId: providerInfo?.model ?? 'cloud',
    };
}

function getProtocolFamily(provider: ModelProviderName): string {
    if (provider === 'webllm') {
        return 'webllm-browser';
    }
    if (provider === 'anthropic') {
        return 'anthropic-messages';
    }
    if (provider === 'openai') {
        return 'openai-responses';
    }
    return 'openai-chat-completions';
}

export function createRouteCandidate(backend: RunnableAiBackend): ModelRouteCandidate {
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
