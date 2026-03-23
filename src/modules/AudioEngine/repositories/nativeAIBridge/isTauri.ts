export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

export async function invokeAI(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        throw new Error('Native AI features require Tauri desktop environment');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
}
