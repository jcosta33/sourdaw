import { invoke } from '@tauri-apps/api/core';

export function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function tauriInvoke<TResult>(cmd: string, args?: Record<string, unknown>): Promise<TResult> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    const result = await invoke(cmd, args);
    return result as TResult;
}
