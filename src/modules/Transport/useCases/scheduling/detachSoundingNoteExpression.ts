import { heldNotesByTrack, type HeldNote } from './heldNoteExpressionState';

/**
 * Empty the registry at a relocation and hand back, by track, the notes that can still be addressed after
 * it: those that follow the channel bend. A note with only its own curve points has nothing left to move
 * once they are forgotten. The caller carries each returned note into the pass it relocates to
 * (`relocateHeldNoteExpression`) on every track, whatever its window does there; a note it does not carry
 * (a frozen track, an instrument that no longer voices it, a track that no longer exists) stays forgotten.
 */
export function detachSoundingNoteExpression(): Map<string, HeldNote[]> {
    const sounding = new Map<string, HeldNote[]>();
    for (const [trackId, notes] of heldNotesByTrack) {
        const followers = notes.filter((note) => note.followsChannelBend);
        if (followers.length > 0) {
            sounding.set(trackId, followers);
        }
    }
    heldNotesByTrack.clear();
    return sounding;
}
