import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/**
 * Whether a built-in device type's native body is set up from calibration state
 * the runtime holds, so an offline render captures it with the document. Exhaustive
 * over the vocabulary, so a new built-in id fails to compile here until decided (ADR 0063).
 */
const CAPTURES_NATIVE_CALIBRATION_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: boolean } = {
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
    levain: false,
    'builtin-crumbs': false,
    'grand-boule': true,
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

/** True for a device type whose native body takes captured calibration state; false for any other string. */
export function capturesNativeCalibration(deviceType: string): boolean {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? false : CAPTURES_NATIVE_CALIBRATION_BY_DEVICE_TYPE[builtinType];
}
