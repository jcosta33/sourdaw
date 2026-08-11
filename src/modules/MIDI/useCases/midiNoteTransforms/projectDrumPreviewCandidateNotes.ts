import { type MidiNote } from '../../models/MidiNote';

type DrumPreviewRecipe = 'ghost-note-pocket' | 'half-time-space' | 'syncopated-hats';

type ProjectDrumPreviewCandidateNotesInput = {
    branchId: string;
    endBeat: number;
    notes: readonly MidiNote[];
    recipe: DrumPreviewRecipe;
    role: 'snare' | 'hi-hat';
    startBeat: number;
};

function isValidSourceNote(note: MidiNote, startBeat: number, endBeat: number): boolean {
    return (
        typeof note.id === 'string' &&
        note.id.length > 0 &&
        Number.isFinite(note.pitch) &&
        Number.isFinite(note.startBeat) &&
        Number.isFinite(note.duration) &&
        Number.isFinite(note.velocity) &&
        note.startBeat >= startBeat &&
        note.startBeat < endBeat &&
        note.duration > 0 &&
        note.startBeat + note.duration <= endBeat &&
        note.velocity >= 1 &&
        note.velocity <= 127
    );
}

function cloneNote(note: MidiNote): MidiNote {
    return { ...note };
}

function sortNotes(notes: MidiNote[]): MidiNote[] {
    return notes.toSorted(
        (left, right) =>
            left.startBeat - right.startBeat ||
            left.pitch - right.pitch ||
            (left.channel ?? 0) - (right.channel ?? 0) ||
            left.id.localeCompare(right.id)
    );
}

function projectGhostNotePocket(input: ProjectDrumPreviewCandidateNotesInput): MidiNote[] {
    if (input.role === 'hi-hat') {
        return input.notes.map((note, index) => ({
            ...note,
            velocity: Math.max(1, Math.min(127, note.velocity + (index % 2 === 0 ? 8 : -8))),
        }));
    }

    const projected = input.notes.map(cloneNote);
    for (const note of input.notes) {
        const startBeat = note.startBeat - 0.5;
        if (startBeat < input.startBeat) {
            continue;
        }
        projected.push({
            ...note,
            id: `preview-${input.branchId}-ghost-${note.id}`,
            startBeat,
            duration: Math.min(note.duration, 0.125),
            velocity: Math.max(1, Math.round(note.velocity * 0.45)),
        });
    }
    return sortNotes(projected);
}

function projectHalfTimeSpace(input: ProjectDrumPreviewCandidateNotesInput): MidiNote[] {
    return input.notes.filter((_note, index) => index % 2 === 0).map(cloneNote);
}

function projectSyncopatedHats(input: ProjectDrumPreviewCandidateNotesInput): MidiNote[] {
    if (input.role === 'snare') {
        return input.notes.map((note, index) => {
            if (index % 2 === 0 || note.startBeat + 0.25 + note.duration > input.endBeat) {
                return cloneNote(note);
            }
            return { ...note, startBeat: note.startBeat + 0.25 };
        });
    }

    const projected = input.notes.map(cloneNote);
    for (const note of input.notes) {
        const startBeat = note.startBeat + 0.5;
        if (startBeat + 0.125 > input.endBeat) {
            continue;
        }
        projected.push({
            ...note,
            id: `preview-${input.branchId}-offbeat-${note.id}`,
            startBeat,
            duration: Math.min(note.duration, 0.125),
            velocity: Math.max(1, Math.round(note.velocity * 0.72)),
        });
    }
    return sortNotes(projected);
}

export function projectDrumPreviewCandidateNotes(
    input: ProjectDrumPreviewCandidateNotesInput
): readonly MidiNote[] | null {
    if (
        input.branchId.length === 0 ||
        !Number.isFinite(input.startBeat) ||
        !Number.isFinite(input.endBeat) ||
        input.endBeat <= input.startBeat ||
        input.notes.length < 2 ||
        new Set(input.notes.map(({ id }) => id)).size !== input.notes.length ||
        !input.notes.every((note) => isValidSourceNote(note, input.startBeat, input.endBeat))
    ) {
        return null;
    }

    if (input.recipe === 'ghost-note-pocket') {
        return projectGhostNotePocket(input);
    }
    if (input.recipe === 'half-time-space') {
        return projectHalfTimeSpace(input);
    }
    return projectSyncopatedHats(input);
}
