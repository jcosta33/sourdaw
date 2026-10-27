import { projectStore } from '#/modules/Project/stores';
import { clampVelocity } from '#/utils/midiData';
import { quantizeMidiNoteToScale } from '#/utils/Music/MusicalScale';
import { createSeededRandom } from '#/utils/SeededRandom/SeededRandom';

import { type MidiNote } from '../../models/MidiNote';
import { invertMidiNotes } from '../../transformers/invertMidiNotes';
import { quantizeMidiNoteLengths } from '../../transformers/quantizeMidiNoteLengths';
import { quantizeMidiNotes } from '../../transformers/quantizeMidiNotes';
import { retrogradeMidiNotes } from '../../transformers/retrogradeMidiNotes';
import { scaleMidiVelocities } from '../../transformers/scaleMidiVelocities';
import { setMidiVelocities } from '../../transformers/setMidiVelocities';
import { transposeMidiNotes } from '../../transformers/transposeMidiNotes';

export type MidiNoteMenuTransform =
    | { kind: 'quantize'; gridSize: number }
    | { kind: 'quantize-length'; gridSize: number }
    | { kind: 'transpose'; semitones: number }
    | { kind: 'invert' }
    | { kind: 'retrograde' }
    | { kind: 'scale-velocity'; factor: number }
    | { kind: 'set-velocity'; velocity: number }
    | { kind: 'snap-scale' }
    | { kind: 'humanize'; timingAmount: number; seed: number }
    | { kind: 'strum'; direction: 'up' | 'down'; amount: number };

/** Project the menu's existing note algorithms without writing the base clip store. */
export function projectMidiNoteMenuTransform(notes: readonly MidiNote[], transform: MidiNoteMenuTransform): MidiNote[] {
    switch (transform.kind) {
        case 'quantize':
            return quantizeMidiNotes({ notes, gridSize: transform.gridSize });
        case 'quantize-length':
            return quantizeMidiNoteLengths({ notes, gridSize: transform.gridSize });
        case 'transpose':
            return transposeMidiNotes({ notes, semitones: transform.semitones });
        case 'invert':
            return invertMidiNotes(notes);
        case 'retrograde':
            return retrogradeMidiNotes(notes);
        case 'scale-velocity':
            return scaleMidiVelocities({ notes, factor: transform.factor });
        case 'set-velocity':
            return setMidiVelocities({ notes, velocity: transform.velocity });
        case 'snap-scale': {
            const project = projectStore.value;
            return project
                ? notes.map((note) => ({
                      ...note,
                      pitch: quantizeMidiNoteToScale(note.pitch, project.keyRoot, project.scaleName),
                  }))
                : notes.map((note) => ({ ...note }));
        }
        case 'humanize': {
            const random = createSeededRandom(transform.seed);
            return notes.map((note) => ({
                ...note,
                startBeat: note.startBeat + (random() - 0.5) * transform.timingAmount * 0.25,
                velocity: clampVelocity(note.velocity + Math.round((random() - 0.5) * transform.timingAmount * 10)),
            }));
        }
        case 'strum': {
            const sorted = [...notes].sort((a, b) =>
                transform.direction === 'up' ? a.pitch - b.pitch : b.pitch - a.pitch
            );
            const offsets = new Map(sorted.map((note, index) => [note.id, index * transform.amount]));
            return notes.map((note) => ({
                ...note,
                startBeat: Math.max(0, note.startBeat + (offsets.get(note.id) ?? 0)),
            }));
        }
    }
}
