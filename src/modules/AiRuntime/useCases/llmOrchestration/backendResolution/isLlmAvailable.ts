import { resolveBackend } from './helpers';

/**
 * Whether ANY LLM backend is available (including cloud for chat).
 */
export function isLlmAvailable(): boolean {
    return resolveBackend() !== 'none';
}