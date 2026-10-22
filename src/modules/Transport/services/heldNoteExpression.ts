/**
 * The recorded expression changes of notes that have started and are still sounding, so each change
 * is posted by the scheduler window whose beat range contains it, not all at once with the note.
 *
 * A note posts its note-on, its release and the changes of its own window when it starts, and parks the
 * changes of later windows here. A long note with a dense curve would otherwise queue its whole life in
 * one call, past what an engine's live queue holds. The changes keep the frames the start window placed
 * them on, the clock its release was placed on, so a change can never land on the other side of it.
 *
 * Module state, because the scheduler that parks and the transport teardown that forgets are separate
 * use cases sharing one process-wide playback. Only notes this playback started are here: a note a seek
 * lands inside was never started, so none of its changes ever post.
 */

/** The full expression in force at one change, in wire units. */
type HeldExpression = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
};

type HeldNoteExpressionChange = {
    /** The absolute beat of the change: the scheduler window containing it posts it. */
    beat: number;
    /** The frame the change applies at. */
    frame: number;
    expression: HeldExpression;
};

type HeldNote = {
    pitch: number;
    channel: number;
    /** In time order. */
    changes: readonly HeldNoteExpressionChange[];
    /** The first change not yet taken. */
    next: number;
};

type HoldNoteExpressionInput = {
    trackId: string;
    pitch: number;
    channel: number;
    changes: readonly HeldNoteExpressionChange[];
};

export type DueNoteExpression = {
    pitch: number;
    channel: number;
    change: HeldNoteExpressionChange;
};

const heldByTrack = new Map<string, HeldNote[]>();

/** Park the changes of a started note that later windows own. */
export function holdNoteExpression({ trackId, pitch, channel, changes }: HoldNoteExpressionInput): void {
    if (changes.length === 0) {
        return;
    }
    const held = heldByTrack.get(trackId) ?? [];
    held.push({ pitch, channel, changes, next: 0 });
    heldByTrack.set(trackId, held);
}

/**
 * Take every parked change of one track that lies before `toBeat`, and forget it. A change before
 * `fromBeat` belongs to a window that did not run for this track (it was muted), so it is dropped, not
 * posted late: only a change inside the window is due.
 */
export function takeHeldNoteExpression(trackId: string, fromBeat: number, toBeat: number): DueNoteExpression[] {
    const held = heldByTrack.get(trackId);
    if (!held) {
        return [];
    }
    const due: DueNoteExpression[] = [];
    const remaining: HeldNote[] = [];
    for (const note of held) {
        let next = note.next;
        while (next < note.changes.length && note.changes[next]!.beat < toBeat) {
            const change = note.changes[next]!;
            if (change.beat >= fromBeat) {
                due.push({ pitch: note.pitch, channel: note.channel, change });
            }
            next++;
        }
        if (next < note.changes.length) {
            remaining.push({ ...note, next });
        }
    }
    if (remaining.length === 0) {
        heldByTrack.delete(trackId);
    } else {
        heldByTrack.set(trackId, remaining);
    }
    return due;
}

/** Drop every parked change: playback stopped, jumped or wrapped, and the notes they belong to are over. */
export function forgetHeldNoteExpression(): void {
    heldByTrack.clear();
}
