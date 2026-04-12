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
import { Harmonizer } from './processors/Harmonizer';
import { CCGenerator } from './processors/CCGenerator';
import { GrooveModule } from './processors/GrooveModule';
import { EuclideanGenerator } from './processors/EuclideanGenerator';
import { MarkovChain } from './processors/MarkovChain';
import { MutationEngine } from './processors/MutationEngine';
import { ChordMemory } from './processors/ChordMemory';

export type ProcessorType =
    | 'arpeggiator'
    | 'chord'
    | 'chordMemory'
    | 'scale'
    | 'harmonizer'
    | 'repeater'
    | 'velocity'
    | 'humanizer'
    | 'filter'
    | 'transposer'
    | 'groove'
    | 'ccGenerator'
    | 'euclidean'
    | 'markov'
    | 'mutation';

export const PROCESSOR_TYPES: Array<{ type: ProcessorType; name: string; description: string; level: number }> = [
    // Phase 2 — Playable Core
    { type: 'arpeggiator', name: 'Arpeggiator', description: 'Transform held chords into rhythmic patterns', level: 1 },
    { type: 'chord', name: 'Chord Generator', description: 'Build chords from single notes', level: 2 },
    { type: 'scale', name: 'Scale Quantizer', description: 'Constrain notes to a musical scale', level: 2 },
    // Phase 3 — Harmonic Tools
    { type: 'harmonizer', name: 'Harmonizer', description: 'Add scale-aware harmony voices', level: 2 },
    { type: 'transposer', name: 'Transposer', description: 'Shift pitch by semitones or octaves', level: 2 },
    // Phase 4 — Feel Tools
    { type: 'repeater', name: 'Note Repeater', description: 'Echo notes with decay and pitch offset', level: 3 },
    { type: 'velocity', name: 'Velocity', description: 'Shape note velocity curves', level: 3 },
    { type: 'humanizer', name: 'Humanizer', description: 'Add per-note timing and velocity variation', level: 3 },
    { type: 'groove', name: 'Groove', description: 'Apply groove templates and timing offsets', level: 3 },
    { type: 'filter', name: 'Note Filter', description: 'Filter notes by range, velocity, or pitch class', level: 3 },
    { type: 'ccGenerator', name: 'CC Generator', description: 'Generate CC messages from LFO shapes', level: 4 },
    // Phase 6 — Lab
    { type: 'chordMemory', name: 'Chord Memory', description: 'One-finger chord recall (Cthulhu-style)', level: 2 },
    { type: 'euclidean', name: 'Euclidean', description: 'Distribute hits evenly across steps', level: 5 },
    { type: 'markov', name: 'Markov Chain', description: 'Probabilistic note selection with memory', level: 5 },
    { type: 'mutation', name: 'Mutation', description: 'Slowly drift parameters for evolving patterns', level: 5 },
];

export function createProcessor(type: ProcessorType, id?: string): MidiProcessor {
    switch (type) {
        case 'arpeggiator':
            return new Arpeggiator(id);
        case 'chord':
            return new ChordGenerator(id);
        case 'chordMemory':
            return new ChordMemory(id);
        case 'scale':
            return new ScaleQuantizer(id);
        case 'harmonizer':
            return new Harmonizer(id);
        case 'repeater':
            return new NoteRepeater(id);
        case 'velocity':
            return new VelocityProcessor(id);
        case 'humanizer':
            return new Humanizer(id);
        case 'filter':
            return new NoteFilter(id);
        case 'transposer':
            return new Transposer(id);
        case 'groove':
            return new GrooveModule(id);
        case 'ccGenerator':
            return new CCGenerator(id);
        case 'euclidean':
            return new EuclideanGenerator(id);
        case 'markov':
            return new MarkovChain(id);
        case 'mutation':
            return new MutationEngine(id);
    }
}
