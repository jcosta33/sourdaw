import { isTauri } from '#/utils/tauriRuntime';

export async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        return null;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
}
