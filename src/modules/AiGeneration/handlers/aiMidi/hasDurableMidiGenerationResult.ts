import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';

type MidiNote = ReturnType<typeof getNotesForClip>[number];

type HasDurableMidiGenerationResultInput = {
    trackId: string;
    clip: {
        id: string;
        name: string;
        startBeat: number;
        endBeat: number;
        type: string;
    };
    notes: readonly MidiNote[];
    noteMatch: 'contains' | 'exact';
};

function areMidiNotesEqual(alpha: MidiNote, beta: MidiNote): boolean {
    return (
        alpha.id === beta.id &&
        alpha.pitch === beta.pitch &&
        alpha.startBeat === beta.startBeat &&
        alpha.duration === beta.duration &&
        alpha.velocity === beta.velocity &&
        alpha.probability === beta.probability &&
        alpha.pressure === beta.pressure &&
        alpha.slide === beta.slide &&
        alpha.pitchBend === beta.pitchBend &&
        alpha.pitchBendRangeSemitones === beta.pitchBendRangeSemitones &&
        alpha.channel === beta.channel &&
        alpha.articulation === beta.articulation
    );
}

export function hasDurableMidiGenerationResult(input: HasDurableMidiGenerationResultInput): boolean {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === input.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === input.clip.id);
    if (
        !clip ||
        clip.name !== input.clip.name ||
        clip.startBeat !== input.clip.startBeat ||
        clip.endBeat !== input.clip.endBeat ||
        clip.type !== input.clip.type
    ) {
        return false;
    }

    const currentNotes = getNotesForClip(input.clip.id);
    if (input.noteMatch === 'exact') {
        if (currentNotes.length !== input.notes.length) {
            return false;
        }
        return currentNotes.every((note, index) => areMidiNotesEqual(note, input.notes[index]!));
    }

    return input.notes.every((expected) => currentNotes.some((note) => areMidiNotesEqual(note, expected)));
}
