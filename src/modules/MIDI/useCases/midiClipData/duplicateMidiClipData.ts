import { midiStore } from '../../stores/midiStore';

type DuplicateMidiClipDataInput = {
    copies: readonly { sourceClipId: string; targetClipId: string }[];
};

export function duplicateMidiClipData({ copies }: DuplicateMidiClipDataInput): () => void {
    if (copies.length === 0) {
        return () => undefined;
    }

    const state = midiStore.value;
    if (state === null) {
        return () => undefined;
    }

    const notesByClipId = { ...state.notesByClipId };
    const ccByClipId = { ...state.ccByClipId };
    const pitchBendByClipId = { ...state.pitchBendByClipId };
    let hasDuplicatedData = false;

    for (const { sourceClipId, targetClipId } of copies) {
        const sourceNotes = state.notesByClipId[sourceClipId];
        if (sourceNotes !== undefined && sourceNotes.length > 0) {
            notesByClipId[targetClipId] = sourceNotes.map((note) => ({
                ...note,
                id: `note-dup-${crypto.randomUUID().slice(0, 8)}`,
            }));
            hasDuplicatedData = true;
        }

        const sourceControlChanges = state.ccByClipId[sourceClipId];
        if (sourceControlChanges !== undefined && sourceControlChanges.length > 0) {
            ccByClipId[targetClipId] = sourceControlChanges.map((controlChange) => ({
                ...controlChange,
                id: `cc-dup-${crypto.randomUUID().slice(0, 8)}`,
            }));
            hasDuplicatedData = true;
        }

        const sourcePitchBends = state.pitchBendByClipId[sourceClipId];
        if (sourcePitchBends !== undefined && sourcePitchBends.length > 0) {
            pitchBendByClipId[targetClipId] = sourcePitchBends.map((pitchBend) => ({
                ...pitchBend,
                id: `pb-dup-${crypto.randomUUID().slice(0, 8)}`,
            }));
            hasDuplicatedData = true;
        }
    }

    if (!hasDuplicatedData) {
        return () => undefined;
    }

    const previousState = state;
    const targetClipIds = new Set(copies.map(({ targetClipId }) => targetClipId));
    const committedNotes = new Map<string, NonNullable<(typeof notesByClipId)[string]>>();
    const committedControlChanges = new Map<string, NonNullable<(typeof ccByClipId)[string]>>();
    const committedPitchBends = new Map<string, NonNullable<(typeof pitchBendByClipId)[string]>>();
    for (const targetClipId of targetClipIds) {
        const notes = notesByClipId[targetClipId];
        const controlChanges = ccByClipId[targetClipId];
        const pitchBends = pitchBendByClipId[targetClipId];
        if (notes !== undefined && notes !== state.notesByClipId[targetClipId]) {
            committedNotes.set(targetClipId, notes);
        }
        if (controlChanges !== undefined && controlChanges !== state.ccByClipId[targetClipId]) {
            committedControlChanges.set(targetClipId, controlChanges);
        }
        if (pitchBends !== undefined && pitchBends !== state.pitchBendByClipId[targetClipId]) {
            committedPitchBends.set(targetClipId, pitchBends);
        }
    }

    let rollbackConsumed = false;
    function rollback(): void {
        if (rollbackConsumed) {
            return;
        }
        const current = midiStore.value;
        if (current === null) {
            rollbackConsumed = true;
            return;
        }

        let nextNotes = current.notesByClipId;
        let nextControlChanges = current.ccByClipId;
        let nextPitchBends = current.pitchBendByClipId;
        let changed = false;

        for (const [targetClipId, committed] of committedNotes) {
            if (nextNotes[targetClipId] !== committed) {
                continue;
            }
            nextNotes = nextNotes === current.notesByClipId ? { ...nextNotes } : nextNotes;
            const previous = previousState.notesByClipId[targetClipId];
            if (previous === undefined) {
                delete nextNotes[targetClipId];
            } else {
                nextNotes[targetClipId] = previous;
            }
            changed = true;
        }
        for (const [targetClipId, committed] of committedControlChanges) {
            if (nextControlChanges[targetClipId] !== committed) {
                continue;
            }
            nextControlChanges =
                nextControlChanges === current.ccByClipId ? { ...nextControlChanges } : nextControlChanges;
            const previous = previousState.ccByClipId[targetClipId];
            if (previous === undefined) {
                delete nextControlChanges[targetClipId];
            } else {
                nextControlChanges[targetClipId] = previous;
            }
            changed = true;
        }
        for (const [targetClipId, committed] of committedPitchBends) {
            if (nextPitchBends[targetClipId] !== committed) {
                continue;
            }
            nextPitchBends = nextPitchBends === current.pitchBendByClipId ? { ...nextPitchBends } : nextPitchBends;
            const previous = previousState.pitchBendByClipId[targetClipId];
            if (previous === undefined) {
                delete nextPitchBends[targetClipId];
            } else {
                nextPitchBends[targetClipId] = previous;
            }
            changed = true;
        }

        if (changed) {
            midiStore.set({
                ...current,
                notesByClipId: nextNotes,
                ccByClipId: nextControlChanges,
                pitchBendByClipId: nextPitchBends,
            });
        }
        rollbackConsumed = true;
    }

    try {
        midiStore.set({ ...state, notesByClipId, ccByClipId, pitchBendByClipId });
    } catch (error) {
        try {
            rollback();
        } catch {
            // Preserve the original mutation failure if restoration also fails.
        }
        throw error;
    }
    return rollback;
}
