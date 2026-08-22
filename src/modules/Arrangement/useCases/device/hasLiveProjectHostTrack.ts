import { getAllTracks } from '../../repositories/track/getAllTracks';

/**
 * Whether project truth still holds the track a compiled device-chain snapshot
 * describes.
 *
 * Every device-chain delta is compiled from project snapshots taken while the
 * action executes, but the deltas are submitted from post-commit effects that
 * run only after the *whole* batch commits — and the engine validates them
 * against final project authority. A later action in the same commit that
 * removes the host track (undoing a group that created a bus and put a device
 * on it inverts to exactly that) leaves the snapshot describing a track project
 * truth no longer has.
 *
 * That is the one unsound inference every deferred device-chain effect makes,
 * so it is decided here and nowhere else. Copies of this check spread across
 * the handlers is how the defect comes back.
 */
export function hasLiveProjectHostTrack(trackId: string): boolean {
    return getAllTracks().some((track) => track.id === trackId);
}
