import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/**
 * Whether each built-in device type voices a per-note articulation (a name carried on a note
 * that selects how the instrument plays it). Exhaustive over the vocabulary, so a new built-in
 * id fails to compile here until its row is decided (ADR 0063). The engine id each name maps to
 * is the instrument module's own table, registered at boot; this answers only which devices have one.
 */
const VOICES_PER_NOTE_ARTICULATION_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: boolean } = {
    'builtin-eq': false,
    'builtin-compressor': false,
    'builtin-reverb': false,
    'builtin-delay': false,
    'builtin-gain': false,
    'builtin-sidechain-compressor': false,
    'builtin-chorus': false,
    'builtin-phaser': false,
    'builtin-distortion': false,
    'builtin-limiter': false,
    'builtin-flanger': false,
    'builtin-tremolo': false,
    'builtin-bitcrusher': false,
    'builtin-filter': false,
    'builtin-autopan': false,
    'builtin-convolution-reverb': false,
    'builtin-stereo-widener': false,
    'builtin-deesser': false,
    'builtin-lufs-meter': false,
    'builtin-synth': false,
    'builtin-synth-mellotron': false,
    'builtin-synth-strings': false,
    'builtin-synth-808bass': false,
    'builtin-synth-brass': false,
    'builtin-drum-kit': false,
    'builtin-drum-machine-808': false,
    'builtin-drum-machine-analog': false,
    'builtin-drum-machine-electronic': false,
    'builtin-drum-machine-acoustic': false,
    fermenter: false,
    toaster: false,
    levain: true,
    'builtin-crumbs': false,
    'grand-boule': false,
    gluten: false,
    crust: false,
    bacteria: false,
    grinder: false,
    proof: false,
    'dutch-oven': false,
    'native-scoring': false,
    knead: false,
    'transient-shaper': false,
    yeast: false,
    'drum-kit': false,
    synth: false,
};

/** True when the device type voices a per-note articulation. A Faust, hosted or unknown type does not. */
export function voicesPerNoteArticulation(deviceType: string): boolean {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType !== null && VOICES_PER_NOTE_ARTICULATION_BY_DEVICE_TYPE[builtinType];
}
