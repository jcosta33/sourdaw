declare global {
    interface Window {
        __TAURI__?: {
            core: {
                invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
            };
        };
    }
}

export function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    return window.__TAURI__!.core.invoke<T>(cmd, args);
}
