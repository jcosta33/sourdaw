import { type SidechainStoreState } from '#/modules/Routing/stores';

import { type DeviceNodeEntry } from '../buildDeviceChain';

import { type OfflineTrackStrip } from './types';

type ConnectOfflineSidechainRoutesInput = {
    offlineCtx: OfflineAudioContext;
    routes: SidechainStoreState['routes'];
    trackStripsById: ReadonlyMap<string, OfflineTrackStrip>;
    deviceEntriesByTrack: ReadonlyMap<string, DeviceNodeEntry[]>;
};

export function connectOfflineSidechainRoutes({
    offlineCtx,
    routes,
    trackStripsById,
    deviceEntriesByTrack,
}: ConnectOfflineSidechainRoutesInput): void {
    const connectedRoutes = new Set<string>();
    for (const route of routes) {
        const routeKey = `${route.sourceTrackId}→${route.targetDeviceId}`;
        const sourceStrip = trackStripsById.get(route.sourceTrackId);
        const targetDevice = deviceEntriesByTrack
            .get(route.targetTrackId)
            ?.find((entry) => entry.deviceId === route.targetDeviceId);
        if (
            !sourceStrip ||
            connectedRoutes.has(routeKey) ||
            targetDevice?.deviceType !== 'builtin-sidechain-compressor' ||
            targetDevice.node.inputNode.numberOfInputs < 2
        ) {
            continue;
        }

        const routeGain = offlineCtx.createGain();
        routeGain.gain.value = Math.max(0, Math.min(1, route.gain));
        sourceStrip.outputNode.connect(routeGain);
        routeGain.connect(targetDevice.node.inputNode, 0, 1);
        connectedRoutes.add(routeKey);
    }
}
