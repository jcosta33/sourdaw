import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/**
 * Two device-role answers about a built-in device type.
 *
 * - `midiTransform` - the device rewrites a track's notes and contributes no
 *   audio node (Yeast). A track holding one has its notes produced by that
 *   device's rack, whichever instrument voices them.
 * - `offlineSource` - the device makes the sound in an offline render, so a
 *   bounce without inserts keeps it. Effects, native processors and the
 *   built-in synth family are not sources here: the synth is voiced from the
 *   track's synth parameters, not from a kept chain node. Yeast is a source
 *   although it makes no audio, because the offline scheduler keys note
 *   projection off its presence on the track, so it must survive the insert
 *   filter.
 * - `padOutputHost` - the device hosts one output per pad, and its folder
 *   track's children are those pads' tracks (Toaster).
 */
export type DeviceRoles = Readonly<{
    midiTransform: boolean;
    offlineSource: boolean;
    padOutputHost: boolean;
}>;

const NONE: DeviceRoles = { midiTransform: false, offlineSource: false, padOutputHost: false };
const SOURCE: DeviceRoles = { midiTransform: false, offlineSource: true, padOutputHost: false };
const SOURCE_PAD_HOST: DeviceRoles = { midiTransform: false, offlineSource: true, padOutputHost: true };
const TRANSFORM_SOURCE: DeviceRoles = { midiTransform: true, offlineSource: true, padOutputHost: false };

/**
 * The roles of every built-in device type. Exhaustive over the vocabulary, so
 * a new built-in id fails to compile here until its row is decided (ADR 0063).
 */
const DEVICE_ROLES_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: DeviceRoles } = {
    'builtin-eq': NONE,
    'builtin-compressor': NONE,
    'builtin-reverb': NONE,
    'builtin-delay': NONE,
    'builtin-gain': NONE,
    'builtin-sidechain-compressor': NONE,
    'builtin-chorus': NONE,
    'builtin-phaser': NONE,
    'builtin-distortion': NONE,
    'builtin-limiter': NONE,
    'builtin-flanger': NONE,
    'builtin-tremolo': NONE,
    'builtin-bitcrusher': NONE,
    'builtin-filter': NONE,
    'builtin-autopan': NONE,
    'builtin-convolution-reverb': NONE,
    'builtin-stereo-widener': NONE,
    'builtin-deesser': NONE,
    'builtin-lufs-meter': NONE,
    'builtin-synth': NONE,
    'builtin-synth-mellotron': NONE,
    'builtin-synth-strings': NONE,
    'builtin-synth-808bass': NONE,
    'builtin-synth-brass': NONE,
    'builtin-drum-kit': SOURCE,
    'builtin-drum-machine-808': SOURCE,
    'builtin-drum-machine-analog': SOURCE,
    'builtin-drum-machine-electronic': SOURCE,
    'builtin-drum-machine-acoustic': SOURCE,
    fermenter: SOURCE,
    toaster: SOURCE_PAD_HOST,
    levain: SOURCE,
    'builtin-crumbs': SOURCE,
    'grand-boule': SOURCE,
    gluten: NONE,
    crust: NONE,
    bacteria: NONE,
    grinder: NONE,
    proof: NONE,
    'dutch-oven': NONE,
    'native-scoring': NONE,
    knead: NONE,
    'transient-shaper': NONE,
    yeast: TRANSFORM_SOURCE,
    'drum-kit': SOURCE,
    synth: NONE,
};

/**
 * The roles of one raw device type, or null when it is not built-in vocabulary
 * (a Faust module, a hosted plugin, an unknown string).
 */
export function resolveDeviceRoles(deviceType: string): DeviceRoles | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : DEVICE_ROLES_BY_DEVICE_TYPE[builtinType];
}
