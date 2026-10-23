import { heldNotesByTrack, type HeldNote } from './heldNoteExpressionState';

type HoldNoteExpressionInput = HeldNote & { trackId: string };

/** Keep a started note for the windows that move its expression on. */
export function holdNoteExpression({ trackId, ...note }: HoldNoteExpressionInput): void {
    const held = heldNotesByTrack.get(trackId) ?? [];
    held.push(note);
    heldNotesByTrack.set(trackId, held);
}
