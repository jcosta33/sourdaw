import { heldNotesByTrack } from './heldNoteExpressionState';

/**
 * Drop the notes one track's current instrument does not hold: a bypass or a swap panics the notes the
 * instrument was voicing (`allNotesOff`, outside the transport teardown), so their later changes would
 * address a voice that is gone, or a same-pitch note the instrument starts afterwards.
 * `receiverId` is the instrument that plays the track's notes now, undefined when it is bypassed.
 */
export function keepHeldNoteExpressionOnReceiver(trackId: string, receiverId: string | undefined): void {
    const held = heldNotesByTrack.get(trackId);
    if (!held) {
        return;
    }
    heldNotesByTrack.set(
        trackId,
        held.filter((note) => receiverId !== undefined && note.receiverId === receiverId)
    );
}
