/**
 * Yeast processor kinds and the UI catalog for the available MIDI effects.
 *
 * This is pure domain metadata shared by the presentation and runtime
 * boundaries. Worker execution stays in workers/ and does not depend on the
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

/**
 * Compiled per-parameter defaults, one record per processor type.
 *
 * This is the single source of truth a control falls back to when a param is
 * absent from the store, and the value a knob's alt-click/double-click reset
 * gesture returns to. Keeping one map instead of repeating the literal at
 * both the `params?.[name] ?? literal` read site and the `defaultValue`
 * knob prop means the two can never drift apart — the drift is exactly what
 * made every reset gesture in the rack a no-op (RotaryKnob only resets when
 * `defaultValue` differs from the live value).
 */
export const PROCESSOR_PARAM_DEFAULTS: Record<ProcessorType, Record<string, number>> = {
    arpeggiator: {
        mode: 0,
        rate_denom: 8,
        gate: 0.8,
        swing: 0,
        octave_range: 1,
        octave_direction: 0,
        velocity_mode: 0,
        fixed_velocity: 100,
        restart_mode: 1,
        latch: 0,
    },
    chord: {
        chord_type: 0,
        voicing: 0,
        strum_ms: 0,
        strum_direction: 0,
    },
    chordMemory: {
        transpose_mode: 1,
    },
    scale: {
        root: 0,
        scale: 0,
        remap_mode: 0,
        transpose: 0,
    },
    harmonizer: {
        root: 0,
        scale: 0,
        voice0_degrees: 2,
        voice0_enabled: 1,
        voice1_degrees: 4,
        voice1_enabled: 0,
    },
    repeater: {
        repeat_count: 3,
        rate_denom: 16,
        decay: 0.7,
        gate: 0.5,
        pitch_step: 0,
    },
    velocity: {
        mode: 0,
        fixed_vel: 100,
        compress_amount: 0.5,
        curve: 0,
    },
    humanizer: {
        preset: 0,
        timing_sigma_ms: 5,
        vel_sigma: 8,
        timing_mean_ms: 0,
    },
    filter: {
        note_min: 0,
        note_max: 127,
        vel_min: 0,
        vel_max: 127,
        invert: 0,
    },
    transposer: {
        semitones: 0,
        octaves: 0,
        random_range: 0,
    },
    groove: {
        amount: 0.5,
    },
    ccGenerator: {
        cc_number: 1,
        shape: 0,
        rate_denom: 4,
        min: 0,
        max: 127,
        retrigger: 0,
    },
    euclidean: {
        hits: 5,
        steps: 8,
        rotation: 0,
        rate_denom: 16,
        gate: 0.5,
        note: 60,
        velocity: 100,
    },
    markov: {
        rate_denom: 8,
        gate: 0.7,
        velocity: 100,
    },
    mutation: {
        depth: 0.5,
        rate: 1,
    },
};

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
