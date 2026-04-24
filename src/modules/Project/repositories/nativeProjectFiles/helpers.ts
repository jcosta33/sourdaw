declare global {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- global interface augmentation requires interface
    interface Window {
        __TAURI__?: {
            core: {
                invoke: <TResult>(cmd: string, args?: Record<string, unknown>) => Promise<TResult>;
            };
        };
    }
}

export function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
}

export async function tauriInvoke<TResult>(cmd: string, args?: Record<string, unknown>): Promise<TResult> {
    if (!isTauriAvailable()) {
        throw new Error('Tauri not available');
    }
    return window.__TAURI__!.core.invoke<TResult>(cmd, args);
}
