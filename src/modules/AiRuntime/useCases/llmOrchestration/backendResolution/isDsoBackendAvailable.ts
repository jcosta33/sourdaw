import { resolveBackend } from './helpers';

/**
 * Whether a DSO-capable backend is available.
 * Cloud is excluded — it's for chat only, not structured DSO planning.
 */
export function isDsoBackendAvailable(): boolean {
    const backend = resolveBackend();
    return backend === 'native' || backend === 'webllm';
}