import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/**
 * What a sidechain route keys on a device that takes a second (key) input: the
 * parameter the key signal drives.
 */
export type SidechainTargetCapability = Readonly<{ targetParameterId: 'threshold' }>;

const THRESHOLD_KEY: SidechainTargetCapability = { targetParameterId: 'threshold' };

/**
 * The sidechain key input of every built-in device type, or null for a device
 * with no key input. Exhaustive over the vocabulary, so a new built-in id fails
 * to compile here until its row is decided (ADR 0063).
 */
const SIDECHAIN_INPUT_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: SidechainTargetCapability | null } = {
    'builtin-eq': null,
    'builtin-compressor': null,
    'builtin-reverb': null,
    'builtin-delay': null,
    'builtin-gain': null,
    'builtin-sidechain-compressor': THRESHOLD_KEY,
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
    fermenter: null,
    toaster: null,
    levain: null,
    'builtin-crumbs': null,
    'grand-boule': null,
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
 * The sidechain key input of one raw device type, or null when the device has
 * none or the string is not built-in vocabulary (a Faust module, a hosted
 * plugin, an unknown string).
 */
export function resolveSidechainInput(deviceType: string): SidechainTargetCapability | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : SIDECHAIN_INPUT_BY_DEVICE_TYPE[builtinType];
}
