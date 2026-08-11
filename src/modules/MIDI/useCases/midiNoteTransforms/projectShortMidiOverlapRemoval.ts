import { type MidiNote } from '../../models/MidiNote';

type ProjectShortMidiOverlapRemovalInput = {
    notes: readonly MidiNote[];
    tempo: number;
    maximumOverlapMs: number;
};

type ShortenedMidiNote = {
    noteId: string;
    previousDuration: number;
    nextDuration: number;
    overlapMs: number;
};

function isValidNote(note: MidiNote): boolean {
    return (
        note.id.length > 0 &&
        Number.isInteger(note.pitch) &&
        Number.isFinite(note.startBeat) &&
        Number.isFinite(note.duration) &&
        note.duration > 0 &&
        (note.channel === undefined || Number.isInteger(note.channel))
    );
}

export function projectShortMidiOverlapRemoval({
    notes,
    tempo,
    maximumOverlapMs,
}: ProjectShortMidiOverlapRemovalInput): { notes: MidiNote[]; shortenedNotes: ShortenedMidiNote[] } | null {
    if (!Number.isFinite(tempo) || tempo <= 0 || !Number.isFinite(maximumOverlapMs) || maximumOverlapMs <= 0) {
        return null;
    }
    const noteIds = new Set<string>();
    const groups = new Map<string, MidiNote[]>();
    for (const note of notes) {
        if (!isValidNote(note) || noteIds.has(note.id)) {
            return null;
        }
        noteIds.add(note.id);
        const key = `${String(note.channel ?? 0)}\u0000${String(note.pitch)}`;
        const group = groups.get(key) ?? [];
        group.push(note);
        groups.set(key, group);
    }

    const nextDurations = new Map<string, number>();
    const shortenedById = new Map<string, ShortenedMidiNote>();
    for (const group of groups.values()) {
        const ordered = [...group].sort(
            (left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id)
        );
        for (let index = 0; index < ordered.length - 1; index += 1) {
            const note = ordered[index]!;
            const next = ordered[index + 1]!;
            if (note.startBeat === next.startBeat) {
                return null;
            }
            const overlapBeats = note.startBeat + note.duration - next.startBeat;
            if (overlapBeats <= 0) {
                continue;
            }
            const overlapMs = (overlapBeats * 60_000) / tempo;
            const isBoundaryEqual = Math.abs(overlapMs - maximumOverlapMs) <= 1e-9;
            if (isBoundaryEqual || overlapMs >= maximumOverlapMs) {
                continue;
            }
            const nextDuration = next.startBeat - note.startBeat;
            if (nextDuration <= 0) {
                return null;
            }
            nextDurations.set(note.id, nextDuration);
            shortenedById.set(note.id, {
                noteId: note.id,
                previousDuration: note.duration,
                nextDuration,
                overlapMs,
            });
        }
    }

    return {
        notes: notes.map((note) => ({ ...note, duration: nextDurations.get(note.id) ?? note.duration })),
        shortenedNotes: notes.flatMap((note) => {
            const shortened = shortenedById.get(note.id);
            return shortened ? [shortened] : [];
        }),
    };
}
