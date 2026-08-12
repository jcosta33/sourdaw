import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

export type SyncopatedArpeggioNoteProjection = Omit<MidiClipNoteSnapshot, 'id'>;

export type SyncopatedArpeggioChordWindow = {
    startBeat: number;
    endBeat: number;
    pitches: number[];
};

type ProjectSyncopatedArpeggioInput = {
    notes: readonly MidiClipNoteSnapshot[];
};

type ProjectSyncopatedArpeggioOutput = {
    addedNotes: SyncopatedArpeggioNoteProjection[];
    chordWindows: SyncopatedArpeggioChordWindow[];
};

const STEP_BEATS = 0.5;
const OFFBEAT_OFFSET_BEATS = 0.25;
const GATE_BEATS = 0.25;

function isFinitePositive(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

export function projectSyncopatedArpeggio({
    notes,
}: ProjectSyncopatedArpeggioInput): ProjectSyncopatedArpeggioOutput | null {
    if (notes.length < 2 || new Set(notes.map((note) => note.id)).size !== notes.length) {
        return null;
    }
    const groupedByStart = new Map<number, MidiClipNoteSnapshot[]>();
    for (const note of notes) {
        if (
            !Number.isFinite(note.pitch) ||
            !Number.isFinite(note.startBeat) ||
            !isFinitePositive(note.duration) ||
            !Number.isFinite(note.velocity)
        ) {
            return null;
        }
        const group = groupedByStart.get(note.startBeat) ?? [];
        group.push(note);
        groupedByStart.set(note.startBeat, group);
    }

    const groups = [...groupedByStart.entries()]
        .map(([startBeat, chordNotes]) => ({ startBeat, chordNotes }))
        .sort((left, right) => left.startBeat - right.startBeat);
    const addedNotes: SyncopatedArpeggioNoteProjection[] = [];
    const chordWindows: SyncopatedArpeggioChordWindow[] = [];

    for (const [index, group] of groups.entries()) {
        if (group.chordNotes.length < 2) {
            return null;
        }
        const duration = group.chordNotes[0]?.duration;
        if (
            duration === undefined ||
            duration < STEP_BEATS ||
            !Number.isInteger(duration / STEP_BEATS) ||
            group.chordNotes.some((note) => note.duration !== duration)
        ) {
            return null;
        }
        const endBeat = group.startBeat + duration;
        const nextGroup = groups[index + 1];
        if (nextGroup && nextGroup.startBeat !== endBeat) {
            return null;
        }
        const voicedNotes = [...group.chordNotes].sort(
            (left, right) =>
                left.pitch - right.pitch ||
                (left.channel ?? 0) - (right.channel ?? 0) ||
                left.id.localeCompare(right.id)
        );
        chordWindows.push({
            startBeat: group.startBeat,
            endBeat,
            pitches: voicedNotes.map((note) => note.pitch),
        });
        let stepIndex = 0;
        for (let startBeat = group.startBeat + OFFBEAT_OFFSET_BEATS; startBeat < endBeat; startBeat += STEP_BEATS) {
            const source = voicedNotes[stepIndex % voicedNotes.length]!;
            const { id: _sourceNoteId, ...expression } = source;
            addedNotes.push({
                ...expression,
                startBeat,
                duration: GATE_BEATS,
            });
            stepIndex += 1;
        }
    }

    return addedNotes.length > 0 ? { addedNotes, chordWindows } : null;
}
