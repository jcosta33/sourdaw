/**
 * Groove extraction use case.
 * Select a MIDI clip and extract its timing template for applying to other clips.
 *
 * Works by analyzing note onset positions relative to their nearest grid position
 * and capturing the deviation pattern. This pattern can then be applied to
 * perfectly quantized notes to make them feel more "human" or "groovy".
 */

import { midiStore } from '#/modules/Track/stores/midiStore';

export type GrooveTemplate = {
    id: string;
    name: string;
    /** Beat subdivisions and their timing offsets (fraction of grid step) */
    offsets: Array<{
        gridPosition: number; // 0-based beat subdivision index
        timingOffset: number; // deviation in beats (-0.1 to +0.1 typically)
        velocityScale: number; // 0.5 to 1.5 velocity multiplier
    }>;
    gridDivision: number; // e.g. 0.25 = 16th notes
    sourceClipId: string;
};

/**
 * Extract a groove template from a MIDI clip.
 * Analyzes note start positions relative to the nearest grid division
 * and captures the timing deviation pattern.
 *
 * @param clipId - Source MIDI clip to extract groove from
 * @param gridDivision - Grid resolution for analysis (default: 0.25 = 16th notes)
 * @returns A GrooveTemplate that can be applied to other clips
 */
export function extractGrooveFromClip(clipId: string, gridDivision = 0.25): GrooveTemplate | null {
    const notesByClip = midiStore.value?.notesByClipId;
    if (!notesByClip) {
        return null;
    }

    const notes = notesByClip[clipId];
    if (!notes || notes.length === 0) {
        return null;
    }

    // Find clip bounds
    const minBeat = Math.min(...notes.map((n) => n.startBeat));
    const maxBeat = Math.max(...notes.map((n) => n.startBeat + n.duration));
    const clipLength = maxBeat - minBeat;

    // Number of grid positions in the clip
    const gridCount = Math.ceil(clipLength / gridDivision);

    // For each grid position, find notes near it and compute average offset
    const offsets: GrooveTemplate['offsets'] = [];

    for (let i = 0; i < gridCount; i++) {
        const gridBeat = minBeat + i * gridDivision;

        // Find notes within half a grid division of this position
        const nearbyNotes = notes.filter((n) => {
            const distance = Math.abs(n.startBeat - gridBeat);
            return distance < gridDivision * 0.5;
        });

        if (nearbyNotes.length === 0) {
            continue;
        }

        // Average timing offset
        const avgOffset =
            nearbyNotes.reduce((sum, n) => sum + (n.startBeat - gridBeat), 0) /
            nearbyNotes.length;

        // Average velocity relative to 100 (default)
        const avgVelocity = nearbyNotes.reduce((sum, n) => sum + n.velocity, 0) / nearbyNotes.length;
        const velocityScale = Math.max(0.5, Math.min(1.5, avgVelocity / 100));

        offsets.push({
            gridPosition: i % Math.round(1 / gridDivision), // Wrap to one beat
            timingOffset: avgOffset,
            velocityScale,
        });
    }

    return {
        id: `groove-${crypto.randomUUID().slice(0, 8)}`,
        name: `Groove from clip`,
        offsets,
        gridDivision,
        sourceClipId: clipId,
    };
}

/**
 * Apply a groove template to a MIDI clip.
 * Shifts note start positions according to the template's timing offsets
 * and scales velocities.
 *
 * @param clipId - Target MIDI clip to apply groove to
 * @param groove - The groove template to apply
 * @param amount - Strength of groove application (0.0 = none, 1.0 = full)
 * @returns Map of noteId → original startBeat for undo
 */
export function applyGrooveToClip(
    clipId: string,
    groove: GrooveTemplate,
    amount = 1.0
): Map<string, { startBeat: number; velocity: number }> | null {
    const state = midiStore.value;
    if (!state) {
        return null;
    }

    const notes = state.notesByClipId[clipId];
    if (!notes || notes.length === 0) {
        return null;
    }

    const originals = new Map<string, { startBeat: number; velocity: number }>();

    const updatedNotes = notes.map((note) => {
        originals.set(note.id, { startBeat: note.startBeat, velocity: note.velocity });

        // Find the nearest grid position
        const gridIndex = Math.round(note.startBeat / groove.gridDivision);
        const wrappedIndex = gridIndex % Math.round(1 / groove.gridDivision);

        // Find matching groove offset
        const grooveEntry = groove.offsets.find((o) => o.gridPosition === wrappedIndex);
        if (!grooveEntry) {
            return note;
        }

        const newStartBeat = note.startBeat + grooveEntry.timingOffset * amount;
        const newVelocity = Math.max(
            1,
            Math.min(127, Math.round(note.velocity * (1 + (grooveEntry.velocityScale - 1) * amount)))
        );

        return {
            ...note,
            startBeat: Math.max(0, newStartBeat),
            velocity: newVelocity,
        };
    });

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: updatedNotes,
        },
    });

    return originals;
}

/**
 * Restore notes to their original positions (undo groove application).
 */
export function restoreGrooveOriginals(
    clipId: string,
    originals: Map<string, { startBeat: number; velocity: number }>
): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const notes = state.notesByClipId[clipId];
    if (!notes) {
        return;
    }

    const restored = notes.map((note) => {
        const orig = originals.get(note.id);
        if (orig) {
            return { ...note, startBeat: orig.startBeat, velocity: orig.velocity };
        }
        return note;
    });

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: restored,
        },
    });
}
