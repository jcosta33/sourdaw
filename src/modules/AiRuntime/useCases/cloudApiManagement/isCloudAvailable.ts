import { isCloudAvailable as repoIsCloudAvailable } from '../../repositories/cloudLlm/keyManagement';

/**
 * Public boundary for "is the cloud AI backend configured?".
 * Wraps the repository so consumers depend on this use case rather
 * than the repository's internals.
 */
export function isCloudAvailable(): boolean {
    return repoIsCloudAvailable();
}