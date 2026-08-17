import { tauriInvoke as bridgeInvoke } from '#/utils/tauriBridge';

import { isTauriAvailable } from './helpers';

export async function tauriInvoke<TResult>(cmd: string, args?: Record<string, unknown>): Promise<TResult> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    const result = await bridgeInvoke(cmd, args);
    return result as TResult;
}
