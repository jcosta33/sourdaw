import { getAllTracks } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';

/**
 * Resolve the MIDI track to write into. If `targetTrackId` is already a MIDI track its
 * id is returned unchanged. Otherwise a new MIDI track is created by **dispatching** an
 * `addTrack` AppAction (not a direct `addTrack(...)` store mutation) so the creation is
 * recorded on the undo history — undoing the conversion then also removes the track it
 * created, instead of leaving an orphan behind. Returns the new track's id, or `null` if
 * creation failed.
 *
 * The `addTrack` handler mutates the track store synchronously inside `executeAppAction`
 * (before its returned promise resolves), so the new track is visible to the
 * `getAllTracks()` read below without awaiting; the promise carries only the undo /
 * history bookkeeping, which we intentionally let settle on the microtask queue.
 */
export function resolveMidiTrackId(targetTrackId: string, trackName: string): string | null {
    const existingTrack = getAllTracks().find((track) => track.id === targetTrackId);
    if (existingTrack && existingTrack.kind === 'midi') {
        return targetTrackId;
    }

    const idsBefore = new Set(getAllTracks().map((track) => track.id));
    void executeAppAction({ type: 'addTrack', payload: { name: trackName, kind: 'midi' } });
    const created = getAllTracks().find((track) => !idsBefore.has(track.id) && track.kind === 'midi');
    return created?.id ?? null;
}
