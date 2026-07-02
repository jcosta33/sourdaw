import { isTauriAvailable } from './helpers';

export async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauriAvailable()) {
        return null;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
}
