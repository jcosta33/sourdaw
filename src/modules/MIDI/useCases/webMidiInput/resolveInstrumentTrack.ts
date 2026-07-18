import type { Track, TrackStoreState } from '#/modules/Arrangement/stores';

/**
 * Resolve the instrument-bearing track and child-pad route for a MIDI origin.
 *
 * A child track whose parent carries a `toaster` device routes to the parent.
 * This Arrangement-aware decision belongs to the use-case composition layer;
 * repositories receive the resolved instrument port only.
 */
export function resolveInstrumentTrack(
    trackState: TrackStoreState | null,
    trackId: string
): { instrumentTrack: Track; toasterChildPad: number | null } | null {
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
            const toasterChildren = trackState.tracks.filter((track) => track.parentId === targetTrack.parentId);
            return {
                instrumentTrack: parent,
                toasterChildPad: toasterChildren.findIndex((track) => track.id === targetTrack.id),
            };
        }
    }
    return {
        instrumentTrack: targetTrack,
        toasterChildPad: null,
    };
}
