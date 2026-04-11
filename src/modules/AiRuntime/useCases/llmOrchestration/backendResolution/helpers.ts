import { isTauri } from '#/helpers/tauriBridge';
import { isCloudAvailable } from '../../../repositories/cloudLlm/keyManagement';
export type AiBackend = 'native' | 'webllm' | 'cloud' | 'none';

/**
 * Resolve the primary backend for DSO edit planning.
 *
 * Single-model policy: Qwen3-8B only.
 * - native: Tauri desktop (mistral.rs with Constraint::JsonSchema)
 * - webllm: Browser with WebGPU (response_format with EditPlanSchema)
 * - cloud: Claude API — used for CHAT ONLY, not DSO planning
 * - none: no backend available — AI editing is disabled
 *
 * No automatic fallback between model families.
 */
export function resolveBackend(): AiBackend {
    if (isTauri()) {
        return 'native';
    }
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        return 'webllm';
    }
    if (isCloudAvailable()) {
        return 'cloud';
    }
    return 'none';
}