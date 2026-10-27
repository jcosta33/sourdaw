import { heldNotesByTrack } from './heldNoteExpressionState';

/** Drop every held note: playback stopped, jumped or wrapped, and the notes they belong to are over. */
export function forgetHeldNoteExpression(): void {
    heldNotesByTrack.clear();
}
