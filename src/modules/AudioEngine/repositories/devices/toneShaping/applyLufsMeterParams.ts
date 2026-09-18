import { type OfflineDeviceNode } from '../types';

export function applyLufsMeterParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    // The meter has no audio params: `lufs-window` selects which window the
    // readout measures, and `lufs-target` is a UI reference the device panel
    // reads from the descriptor, so it never reaches the graph.
    if (params['lufs-window'] !== undefined) {
        dn.lufsMeter?.setWindow(params['lufs-window']);
    }
}
