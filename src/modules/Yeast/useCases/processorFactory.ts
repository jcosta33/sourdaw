/**
 * Processor factory — creates Yeast MIDI processor instances by type name.
 */

import { type MidiProcessor } from '../models/MidiProcessor';
import { Arpeggiator } from './processors/Arpeggiator';
import { ChordGenerator } from './processors/ChordGenerator';
import { ScaleQuantizer } from './processors/ScaleQuantizer';
import { NoteRepeater } from './processors/NoteRepeater';
import { VelocityProcessor } from './processors/VelocityProcessor';
import { Humanizer } from './processors/Humanizer';
import { NoteFilter } from './processors/NoteFilter';
import { Transposer } from './processors/Transposer';

export type ProcessorType =
    | 'arpeggiator'
    | 'chord'
    | 'scale'
    | 'repeater'
    | 'velocity'
    | 'humanizer'
    | 'filter'
    | 'transposer';

export const PROCESSOR_TYPES: Array<{ type: ProcessorType; name: string; description: string }> = [
    { type: 'arpeggiator', name: 'Arpeggiator', description: 'Transform held chords into rhythmic patterns' },
    { type: 'chord', name: 'Chord Generator', description: 'Build chords from single notes' },
    { type: 'scale', name: 'Scale Quantizer', description: 'Constrain notes to a musical scale' },
    { type: 'repeater', name: 'Note Repeater', description: 'Echo notes with decay and pitch offset' },
    { type: 'velocity', name: 'Velocity', description: 'Shape note velocity curves' },
    { type: 'humanizer', name: 'Humanizer', description: 'Add per-note timing and velocity variation' },
    { type: 'filter', name: 'Note Filter', description: 'Filter notes by range, velocity, or pitch class' },
    { type: 'transposer', name: 'Transposer', description: 'Shift pitch by semitones or octaves' },
];

export function createProcessor(type: ProcessorType, id?: string): MidiProcessor {
    switch (type) {
        case 'arpeggiator': return new Arpeggiator(id);
        case 'chord': return new ChordGenerator(id);
        case 'scale': return new ScaleQuantizer(id);
        case 'repeater': return new NoteRepeater(id);
        case 'velocity': return new VelocityProcessor(id);
        case 'humanizer': return new Humanizer(id);
        case 'filter': return new NoteFilter(id);
        case 'transposer': return new Transposer(id);
    }
}
