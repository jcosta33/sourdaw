import { isTauri } from '#/utils/tauriRuntime';

export async function invokeLink(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        throw new Error('Ableton Link requires Tauri desktop environment');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
}
