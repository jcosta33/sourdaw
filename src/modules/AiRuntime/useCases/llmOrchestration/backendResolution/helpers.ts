import { type AiBackend } from '../../../models/LlmOrchestrationTypes';

import { getBackendChain } from './getBackendChain';

/**
 * Resolve the active inference backend for chat and provider-neutral tool planning.
 *
 * - webllm: browser-local WebGPU runtime
 * - cloud: configured hosted-provider adapter
 * - none: no backend is currently available
 *
 * An explicit unavailable preference fails closed instead of silently changing providers.
 */
export function resolveBackend(requirements?: Parameters<typeof getBackendChain>[0]): AiBackend {
    return getBackendChain(requirements)[0] ?? 'none';
}
