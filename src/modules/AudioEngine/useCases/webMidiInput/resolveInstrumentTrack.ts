import type { Track, TrackStoreState } from '#/modules/Arrangement/stores';

/**
 * Resolve the instrument-bearing track for an explicit MIDI origin track.
 *
 * A child track whose parent carries a `toaster` device routes to the parent.
 * This Arrangement-aware decision belongs to the use-case composition layer;
 * repositories receive the resolved instrument port only.
 */
export function resolveInstrumentTrack(trackState: TrackStoreState | null, trackId: string): Track | null {
    if (!trackId || !trackState) {
        return null;
    }
    const targetTrack = trackState.tracks.find((track) => track.id === trackId);
    if (!targetTrack) {
        return null;
    }
    if (targetTrack.parentId) {
        const parent = trackState.tracks.find((track) => track.id === targetTrack.parentId);
        if (parent?.devices.some((device) => device.type === 'toaster')) {
            return parent;
        }
    }
    return targetTrack;
}
