import { type WiredSidechainDetectorRoute } from './collectWiredSidechainDetectorRoutes';

/**
 * The strips a freeze or bounce render honours the mute of: only the sidechain key sources whose
 * detector feed it wires. Live taps a key after its mute, so a muted key feeds its detector
 * silence; every other strip is force-unmuted, because the render's output is deliverable audio.
 */
export function resolveMuteHonoringTrackIds(wiredDetectorRoutes: readonly WiredSidechainDetectorRoute[]): Set<string> {
    return new Set(wiredDetectorRoutes.map((route) => route.sourceTrackId));
}
