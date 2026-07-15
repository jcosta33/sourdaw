/**
 * Processor factory — creates Yeast MIDI processor instances by type name.
 */

import { type ProcessorType } from '../models/ProcessorCatalog';

import { type MidiProcessor } from './MidiProcessor';
import { Arpeggiator } from './processors/Arpeggiator';
import { CCGenerator } from './processors/CCGenerator';
import { ChordGenerator } from './processors/ChordGenerator';
import { ChordMemory } from './processors/ChordMemory';
import { EuclideanGenerator } from './processors/EuclideanGenerator';
import { GrooveModule } from './processors/GrooveModule';
import { Harmonizer } from './processors/Harmonizer';
import { Humanizer } from './processors/Humanizer';
import { MarkovChain } from './processors/MarkovChain';
import { MutationEngine } from './processors/MutationEngine';
import { NoteFilter } from './processors/NoteFilter';
import { NoteRepeater } from './processors/NoteRepeater';
import { ScaleQuantizer } from './processors/ScaleQuantizer';
import { Transposer } from './processors/Transposer';
import { VelocityProcessor } from './processors/VelocityProcessor';

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
        default:
            throw new Error(`Unknown processor type: ${type}`);
    }
}
