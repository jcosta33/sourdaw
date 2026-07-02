import { invoke } from '@tauri-apps/api/core';

import { isTauriAvailable } from './helpers';

export async function tauriInvoke<TResult>(cmd: string, args?: Record<string, unknown>): Promise<TResult> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    const result = await invoke(cmd, args);
    return result as TResult;
}
