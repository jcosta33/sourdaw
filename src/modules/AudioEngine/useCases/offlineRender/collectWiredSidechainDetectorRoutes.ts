import { type Device, type Track } from '#/modules/Arrangement/stores';

/** A sidechain detector route, as the Routing store spells it. */
export type PrintReachabilitySidechainRoute = Readonly<{
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
}>;

/** A detector route this render actually wires, with its resolved compressor. */
export type WiredSidechainDetectorRoute = Readonly<{
    sourceTrackId: string;
    targetTrackId: string;
    targetDevice: Device;
}>;

export type CollectWiredSidechainDetectorRoutesInput = Readonly<{
    /** Every strip this render builds. */
    tracks: readonly Track[];
    /** Every sidechain route the project holds; unwired ones are filtered out. */
    routes: readonly PrintReachabilitySidechainRoute[];
}>;

/**
 * The sidechain detector routes this render wires: both ends are strips it
 * builds, and the named device on the target is a live compressor.
 *
 * Both renderers filter routes exactly this way before handing the target
 * devices to `prepareOfflineContext`, and the freeze/bounce renderer also
 * derives *which strips have their mute honoured* from the same answer.
 * Returning one list for all three consumers is what keeps "this render wires
 * this detector" and "this render honours this key's mute" from drifting apart.
 */
export function collectWiredSidechainDetectorRoutes({
    tracks,
    routes,
}: CollectWiredSidechainDetectorRoutesInput): readonly WiredSidechainDetectorRoute[] {
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const wired: WiredSidechainDetectorRoute[] = [];
    for (const route of routes) {
        if (!trackById.has(route.sourceTrackId)) {
            continue;
        }
        const targetTrack = trackById.get(route.targetTrackId);
        const targetDevice = targetTrack?.devices.find(
            (device) => device.id === route.targetDeviceId && !device.bypassed
        );
        if (targetDevice?.type !== 'builtin-sidechain-compressor') {
            continue;
        }
        wired.push({ sourceTrackId: route.sourceTrackId, targetTrackId: route.targetTrackId, targetDevice });
    }
    return wired;
}
