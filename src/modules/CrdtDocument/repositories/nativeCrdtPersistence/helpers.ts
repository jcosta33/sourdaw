export function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

export async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauriAvailable()) {
        return null;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
}
