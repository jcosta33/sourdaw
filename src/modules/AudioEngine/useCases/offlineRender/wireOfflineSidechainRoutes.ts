import { type DeviceNodeEntry } from '../buildDeviceChain';

import { type OfflineTrackStrip } from './types';

export type OfflineSidechainRoute = {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
};

/**
 * Wire persisted sidechain routes into the offline render graph, mirroring
 * the live engine (`applySidechainRoute`: source analyser tap → gain →
 * compressor sidechain input). The pre-fader tap matches the live tap
 * position (post-device-chain, pre-fader). Without this, exports of mixes
 * relying on sidechain ducking render the compressor as a plain
 * no-key compressor (M-041).
 */
export function wireOfflineSidechainRoutes(
    offlineCtx: OfflineAudioContext,
    trackStripsById: Map<string, OfflineTrackStrip>,
    deviceEntriesByTrack: Map<string, DeviceNodeEntry[]>,
    routes: readonly OfflineSidechainRoute[]
): void {
    for (const route of routes) {
        const sourceStrip = trackStripsById.get(route.sourceTrackId);
        if (!sourceStrip) {
            continue;
        }
        const targetEntry = deviceEntriesByTrack
            .get(route.targetTrackId)
            ?.find((entry) => entry.deviceId === route.targetDeviceId && entry.deviceType === 'builtin-sidechain-compressor');
        if (!targetEntry) {
            continue;
        }

        const scGain = offlineCtx.createGain();
        scGain.gain.value = 1;
        sourceStrip.preFaderTap.connect(scGain);
        scGain.connect(targetEntry.node.inputNode, 0, 1);
    }
}
