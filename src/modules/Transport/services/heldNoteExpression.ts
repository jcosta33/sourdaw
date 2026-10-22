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
    /** The instrument that voiced the note: a different or bypassed one no longer holds it. */
    receiverId: string | undefined;
    /** The beat the note's release is posted at: past it the note is over and nothing addresses it. */
    releaseBeat: number;
    /** In time order. */
    changes: readonly HeldNoteExpressionChange[];
    /** The first change not yet taken. */
    next: number;
};

type HoldNoteExpressionInput = {
    trackId: string;
    pitch: number;
    channel: number;
    receiverId: string | undefined;
    releaseBeat: number;
    changes: readonly HeldNoteExpressionChange[];
};

type TakeHeldNoteExpressionInput = {
    trackId: string;
    /** Where the window opens. */
    fromBeat: number;
    /** Where the window closes: a change at or past it waits for a later window. */
    toBeat: number;
    /** The frame `fromBeat` is placed on, where the expression in force when the window opens is posted. */
    fromFrame: number;
};

export type DueNoteExpression = {
    pitch: number;
    channel: number;
    change: HeldNoteExpressionChange;
};

const heldByTrack = new Map<string, HeldNote[]>();

/** Park the changes of a started note that later windows own. */
export function holdNoteExpression({
    trackId,
    pitch,
    channel,
    receiverId,
    releaseBeat,
    changes,
}: HoldNoteExpressionInput): void {
    if (changes.length === 0) {
        return;
    }
    const held = heldByTrack.get(trackId) ?? [];
    held.push({ pitch, channel, receiverId, releaseBeat, changes, next: 0 });
    heldByTrack.set(trackId, held);
}

/**
 * Take every parked change of one track that lies before `toBeat`, and forget it. A change inside the
 * window is due as it stands. A change before `fromBeat` belongs to a window that did not run for this
 * track (it was muted), and is never posted late; but the instrument was not told of it, so a note still
 * sounding at `fromBeat` is given the last such change, the full expression in force there, at
 * `fromFrame`, ahead of the window's own changes. A note released before `fromBeat` is over: nothing
 * is posted for it.
 */
export function takeHeldNoteExpression({
    trackId,
    fromBeat,
    toBeat,
    fromFrame,
}: TakeHeldNoteExpressionInput): DueNoteExpression[] {
    const held = heldByTrack.get(trackId);
    if (!held) {
        return [];
    }
    const due: DueNoteExpression[] = [];
    const remaining: HeldNote[] = [];
    for (const note of held) {
        let next = note.next;
        let inForceAtWindowStart: HeldNoteExpressionChange | undefined;
        const inWindow: DueNoteExpression[] = [];
        while (next < note.changes.length && note.changes[next]!.beat < toBeat) {
            const change = note.changes[next]!;
            if (change.beat >= fromBeat) {
                inWindow.push({ pitch: note.pitch, channel: note.channel, change });
            } else {
                inForceAtWindowStart = change;
            }
            next++;
        }
        if (inForceAtWindowStart && note.releaseBeat > fromBeat) {
            due.push({
                pitch: note.pitch,
                channel: note.channel,
                change: { beat: fromBeat, frame: fromFrame, expression: inForceAtWindowStart.expression },
            });
        }
        due.push(...inWindow);
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

/**
 * Drop the parked changes of the notes one track's current instrument does not hold: a bypass or a swap
 * panics the notes the instrument was voicing (`allNotesOff`, outside the transport teardown), so their
 * later changes would address a voice that is gone, or a same-pitch note the instrument starts afterwards.
 * `receiverId` is the instrument that plays the track's notes now, undefined when it is bypassed.
 */
export function keepHeldNoteExpressionOnReceiver(trackId: string, receiverId: string | undefined): void {
    const held = heldByTrack.get(trackId);
    if (!held) {
        return;
    }
    const kept = held.filter((note) => receiverId !== undefined && note.receiverId === receiverId);
    if (kept.length === 0) {
        heldByTrack.delete(trackId);
    } else {
        heldByTrack.set(trackId, kept);
    }
}

/** Drop every parked change: playback stopped, jumped or wrapped, and the notes they belong to are over. */
export function forgetHeldNoteExpression(): void {
    heldByTrack.clear();
}
