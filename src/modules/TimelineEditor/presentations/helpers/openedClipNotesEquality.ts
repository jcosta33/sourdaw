/**
 * Structural equality for the piano roll's secondary-clip note map.
 *
 * `PianoRoll` selects `openedClipNotes` out of `midiStore` with
 * `Object.fromEntries`, so the record and its arrays are rebuilt on every
 * store notification and their identity is never stable. `useStoreSelector`
 * therefore needs an equality predicate to decide whether a rebuild carried a
 * real change or is the same notes in a new wrapper.
 *
 * Notes are compared by their own enumerable keys rather than against a fixed
 * field list. `MidiNoteViewTypes.MidiNote` is a hand-maintained subset of
 * MIDI's note model — it is currently missing `pitchBendRangeSemitones` and
 * `channel`, both of which the store really does carry — and
 * `usePianoRollInteractions` spreads whole note objects back into
 * `setNotesForClip`. A predicate that ignored a field the local view type has
 * not caught up with would hold a stale note and write that staleness back.
 *
 * A clip untouched by a write keeps its whole note array by reference — the
 * selector reads `state.notesByClipId[id]` straight out of the snapshot — so the
 * per-clip identity check settles it in one comparison rather than one per note.
 * Within a changed clip the same holds per note, because the MIDI write paths
 * spread the array and replace only the notes they touch.
 */

/** A note as this predicate sees it: an object of own scalar fields. */
type ComparableNote = Readonly<Record<string, unknown>>;

function areNotesEqual(a: ComparableNote, b: ComparableNote): boolean {
    if (a === b) {
        return true;
    }

    const fields = Object.keys(a);
    if (fields.length !== Object.keys(b).length) {
        return false;
    }

    for (const field of fields) {
        if (!Object.hasOwn(b, field)) {
            return false;
        }
        if (a[field] !== b[field]) {
            return false;
        }
    }

    return true;
}

export function areOpenedClipNotesEqual(
    a: Readonly<Record<string, readonly ComparableNote[]>> | undefined,
    b: Readonly<Record<string, readonly ComparableNote[]>> | undefined
): boolean {
    if (a === b) {
        return true;
    }
    if (a === undefined || b === undefined) {
        return false;
    }

    const clipIds = Object.keys(a);
    if (clipIds.length !== Object.keys(b).length) {
        return false;
    }

    for (const clipId of clipIds) {
        const aNotes = a[clipId];
        const bNotes = b[clipId];
        if (aNotes === undefined || bNotes === undefined) {
            return false;
        }
        if (aNotes === bNotes) {
            continue;
        }
        if (aNotes.length !== bNotes.length) {
            return false;
        }

        for (let index = 0; index < aNotes.length; index += 1) {
            const aNote = aNotes[index];
            const bNote = bNotes[index];
            if (aNote === undefined || bNote === undefined) {
                return false;
            }
            if (!areNotesEqual(aNote, bNote)) {
                return false;
            }
        }
    }

    return true;
}
