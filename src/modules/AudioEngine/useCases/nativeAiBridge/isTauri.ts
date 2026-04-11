import { isTauri as detectTauriEnvironment } from '../../repositories/nativeAIBridge/isTauri';

/**
 * Public contract for native AI bridge operations.
 */
export function isTauri(): boolean {
    return detectTauriEnvironment();
}