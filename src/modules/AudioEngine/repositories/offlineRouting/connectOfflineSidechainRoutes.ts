import { type OfflineDeviceNode } from '../devices/types';

/** Mirrors the live engine's `SIDECHAIN_KEY_MAX_DELAY_SECONDS` so a route that
 *  would be clipped live is clipped identically in the export. */
const OFFLINE_KEY_MAX_DELAY_SECONDS = 1;

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
    /** FX-5 — seconds of key delay this route needs to land on the detector in
     *  step with the program. Injected by the caller (the offline render use
     *  case passes `getSidechainKeyDelay`) so this repository never reads
     *  project state; the live engine takes the same value the same way. */
    keyDelaySecFor: (route: OfflineSidechainRoute) => number;
};

export function connectOfflineSidechainRoutes({
    offlineCtx,
    routes,
    trackStripsById,
    deviceEntriesByTrack,
    keyDelaySecFor,
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
        // FX-5 — same alignment line, same position in the chain, same resolved
        // value as the live path (`applySidechainRoute`): tap → key delay →
        // route gain → detector sidechain input. A render is static, so the
        // value is set once rather than ramped.
        const keyDelay = offlineCtx.createDelay(OFFLINE_KEY_MAX_DELAY_SECONDS);
        keyDelay.delayTime.value = Math.min(Math.max(keyDelaySecFor(route), 0), OFFLINE_KEY_MAX_DELAY_SECONDS);
        sourceStrip.outputNode.connect(keyDelay);
        keyDelay.connect(routeGain);
        routeGain.connect(targetDevice.node.inputNode, 0, 1);
        connectedRoutes.add(routeKey);
    }
}
