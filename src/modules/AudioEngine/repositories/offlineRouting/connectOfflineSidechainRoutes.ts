import { type OfflineDeviceNode } from '../devices/types';

type OfflineSidechainRoute = {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
};

type OfflineSidechainStrip = {
    outputNode: AudioNode;
};

type OfflineSidechainDeviceEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
};

type ConnectOfflineSidechainRoutesInput = {
    offlineCtx: OfflineAudioContext;
    routes: readonly OfflineSidechainRoute[];
    trackStripsById: ReadonlyMap<string, OfflineSidechainStrip>;
    deviceEntriesByTrack: ReadonlyMap<string, readonly OfflineSidechainDeviceEntry[]>;
};

export function connectOfflineSidechainRoutes({
    offlineCtx,
    routes,
    trackStripsById,
    deviceEntriesByTrack,
}: ConnectOfflineSidechainRoutesInput): void {
    const connectedRoutes = new Set<string>();
    for (const route of routes) {
        const routeKey = `${route.sourceTrackId}→${route.targetTrackId}:${route.targetDeviceId}`;
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
        // The live engine currently wires sidechains at unity. Preserve exact
        // playback/export parity until route-gain control is supported live.
        routeGain.gain.value = 1;
        sourceStrip.outputNode.connect(routeGain);
        routeGain.connect(targetDevice.node.inputNode, 0, 1);
        connectedRoutes.add(routeKey);
    }
}
