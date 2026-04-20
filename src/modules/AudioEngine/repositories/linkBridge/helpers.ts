/**
 * Ableton Link Bridge.
 * TS-side interface for communicating with the Rust Link module
 * via Tauri IPC.
 */

export type LinkStatus = {
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
};

export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

export async function invokeLink(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        throw new Error('Ableton Link requires Tauri desktop environment');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
}
