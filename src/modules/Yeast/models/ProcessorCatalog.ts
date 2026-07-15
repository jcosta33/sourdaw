/**
 * Yeast processor kinds and the UI catalog for the available MIDI effects.
 *
 * This is pure domain metadata shared by the presentation and runtime
 * boundaries. Worklet execution stays in worklets/ and does not depend on the
 * presentation catalog.
 */

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
    // Phase 2 - Playable Core
    { type: 'arpeggiator', name: 'Arpeggiator', description: 'Transform held chords into rhythmic patterns', level: 1 },
    { type: 'chord', name: 'Chord Generator', description: 'Build chords from single notes', level: 2 },
    { type: 'scale', name: 'Scale Quantizer', description: 'Constrain notes to a musical scale', level: 2 },
    // Phase 3 - Harmonic Tools
    { type: 'harmonizer', name: 'Harmonizer', description: 'Add scale-aware harmony voices', level: 2 },
    { type: 'transposer', name: 'Transposer', description: 'Shift pitch by semitones or octaves', level: 2 },
    // Phase 4 - Feel Tools
    { type: 'repeater', name: 'Note Repeater', description: 'Echo notes with decay and pitch offset', level: 3 },
    { type: 'velocity', name: 'Velocity', description: 'Shape note velocity curves', level: 3 },
    { type: 'humanizer', name: 'Humanizer', description: 'Add per-note timing and velocity variation', level: 3 },
    { type: 'groove', name: 'Groove', description: 'Apply groove templates and timing offsets', level: 3 },
    { type: 'filter', name: 'Note Filter', description: 'Filter notes by range, velocity, or pitch class', level: 3 },
    { type: 'ccGenerator', name: 'CC Generator', description: 'Generate CC messages from LFO shapes', level: 4 },
    // Phase 6 - Lab
    { type: 'chordMemory', name: 'Chord Memory', description: 'One-finger chord recall (Cthulhu-style)', level: 2 },
    { type: 'euclidean', name: 'Euclidean', description: 'Distribute hits evenly across steps', level: 5 },
    { type: 'markov', name: 'Markov Chain', description: 'Probabilistic note selection with memory', level: 5 },
    { type: 'mutation', name: 'Mutation', description: 'Slowly drift parameters for evolving patterns', level: 5 },
];
