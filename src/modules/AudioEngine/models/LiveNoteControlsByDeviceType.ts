import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

import { type BuiltinDeviceNode } from './AudioEngineState';

/** The three MPE dimensions, named as they appear on note data. */
export type NoteExpressionDimension = 'pitchBend' | 'pressure' | 'slide';

/**
 * How a worklet instrument's engine node takes live notes.
 *
 * - `controlsKey` — the note-control object the node exposes.
 * - `scaleVelocity` — the MIDI velocity (0..127) in the unit that object's
 *   `noteOn` expects.
 * - `expressionDimensions` — the MPE dimensions the engine actually sounds, not
 *   the ones it accepts.
 */
export type LiveNoteControls = Readonly<{
    controlsKey: keyof Pick<
        BuiltinDeviceNode,
        'fermenterControls' | 'grandBouleControls' | 'levainControls' | 'crumbsControls'
    >;
    scaleVelocity: (velocity: number) => number;
    expressionDimensions: readonly NoteExpressionDimension[];
}>;

function midiVelocity(velocity: number): number {
    return velocity;
}

function unitVelocity(velocity: number): number {
    return velocity / 127;
}

const FULL_EXPRESSION: readonly NoteExpressionDimension[] = ['pitchBend', 'pressure', 'slide'];

/**
 * The live note controls of every built-in device type, or null for a device
 * whose node exposes no worklet note controls. Exhaustive over the vocabulary,
 * so a new built-in id fails to compile here until its row is decided (ADR 0063).
 *
 * Grand Boule takes velocity as 0..1 and is bend-only on purpose: its ringing
 * modal strings are retuned in place, but a struck string has no continuous
 * pressure or timbre response to model, so those two are dropped at the engine
 * rather than faked. Crumbs has no per-note bend, pressure or timbre path, so it
 * sounds no expression and the editor never offers those lanes for it. Crumbs'
 * row is keyed by its catalog id, `builtin-crumbs`: without it a Crumbs track
 * fell through to the built-in fallback synth live while the export voiced the
 * real sampler.
 */
const LIVE_NOTE_CONTROLS_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: LiveNoteControls | null } = {
    'builtin-eq': null,
    'builtin-compressor': null,
    'builtin-reverb': null,
    'builtin-delay': null,
    'builtin-gain': null,
    'builtin-sidechain-compressor': null,
    'builtin-chorus': null,
    'builtin-phaser': null,
    'builtin-distortion': null,
    'builtin-limiter': null,
    'builtin-flanger': null,
    'builtin-tremolo': null,
    'builtin-bitcrusher': null,
    'builtin-filter': null,
    'builtin-autopan': null,
    'builtin-convolution-reverb': null,
    'builtin-stereo-widener': null,
    'builtin-deesser': null,
    'builtin-lufs-meter': null,
    'builtin-synth': null,
    'builtin-synth-mellotron': null,
    'builtin-synth-strings': null,
    'builtin-synth-808bass': null,
    'builtin-synth-brass': null,
    'builtin-drum-kit': null,
    'builtin-drum-machine-808': null,
    'builtin-drum-machine-analog': null,
    'builtin-drum-machine-electronic': null,
    'builtin-drum-machine-acoustic': null,
    fermenter: { controlsKey: 'fermenterControls', scaleVelocity: midiVelocity, expressionDimensions: FULL_EXPRESSION },
    toaster: null,
    levain: { controlsKey: 'levainControls', scaleVelocity: midiVelocity, expressionDimensions: FULL_EXPRESSION },
    'builtin-crumbs': { controlsKey: 'crumbsControls', scaleVelocity: midiVelocity, expressionDimensions: [] },
    'grand-boule': {
        controlsKey: 'grandBouleControls',
        scaleVelocity: unitVelocity,
        expressionDimensions: ['pitchBend'],
    },
    gluten: null,
    crust: null,
    bacteria: null,
    grinder: null,
    proof: null,
    'dutch-oven': null,
    'native-scoring': null,
    knead: null,
    'transient-shaper': null,
    yeast: null,
    'drum-kit': null,
    synth: null,
};

/**
 * The live note controls of one device type, or null for a device with no
 * worklet note controls (a Faust module, a hosted plugin, an unknown string).
 */
export function resolveLiveNoteControls(deviceType: string): LiveNoteControls | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : LIVE_NOTE_CONTROLS_BY_DEVICE_TYPE[builtinType];
}
