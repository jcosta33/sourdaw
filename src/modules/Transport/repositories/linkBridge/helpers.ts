/**
 * Ableton Link Bridge.
 * TS-side interface for communicating with the Rust Link module
 * via Tauri IPC.
 */

export type LinkStatus = {
    supported: boolean;
    implementation: string;
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
    message: string | null;
};
