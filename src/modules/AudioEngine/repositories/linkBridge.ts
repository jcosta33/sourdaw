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

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function invokeLink(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauri()) {
        throw new Error('Ableton Link requires Tauri desktop environment');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
}

export async function enableLink(): Promise<LinkStatus> {
    return (await invokeLink('enable_link')) as LinkStatus;
}

export async function disableLink(): Promise<void> {
    await invokeLink('disable_link');
}

export async function setLinkTempo(tempo: number): Promise<void> {
    await invokeLink('set_link_tempo', { tempo });
}

export async function getLinkStatus(): Promise<LinkStatus> {
    return (await invokeLink('get_link_status')) as LinkStatus;
}

export async function linkStartPlaying(): Promise<void> {
    await invokeLink('link_start_playing');
}

export async function linkStopPlaying(): Promise<void> {
    await invokeLink('link_stop_playing');
}
