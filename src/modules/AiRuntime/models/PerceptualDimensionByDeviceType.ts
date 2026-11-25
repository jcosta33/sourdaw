import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

import { type PerceptualExcludedDimension } from './PerceptualConstraint';

/**
 * A device's dimension, and which of its parameter writes edit it: an EQ only through its low
 * band, a filter's type and cutoff decide together so every write counts, and space is space.
 */
type DeviceDimension = Readonly<{
    dimension: PerceptualExcludedDimension;
    writes: 'every-parameter' | 'low-band-parameters';
}>;

const SPACE: DeviceDimension = { dimension: 'ambience', writes: 'every-parameter' };

/**
 * The perceptual dimension a whole built-in device shapes, or null for a device that shapes
 * neither. Exhaustive over the vocabulary, so a new built-in id fails to compile here until
 * its row is decided (ADR 0063).
 *
 * - `low-frequency-band` — spectral shapers, whose removal or bypass changes the low end they shape.
 * - `ambience` — devices that add space around a source.
 *
 * The descriptors' `effectFamily` only names reverbs, so it cannot express these sets and
 * the table is owned here, beside the constraint vocabulary it answers.
 */
const PERCEPTUAL_DIMENSION_BY_DEVICE_TYPE: {
    readonly [Type in BuiltinDeviceType]: DeviceDimension | null;
} = {
    'builtin-eq': { dimension: 'low-frequency-band', writes: 'low-band-parameters' },
    'builtin-compressor': null,
    'builtin-reverb': SPACE,
    'builtin-delay': SPACE,
    'builtin-gain': null,
    'builtin-sidechain-compressor': null,
    'builtin-chorus': SPACE,
    'builtin-phaser': null,
    'builtin-distortion': null,
    'builtin-limiter': null,
    'builtin-flanger': null,
    'builtin-tremolo': null,
    'builtin-bitcrusher': null,
    'builtin-filter': { dimension: 'low-frequency-band', writes: 'every-parameter' },
    'builtin-autopan': null,
    'builtin-convolution-reverb': SPACE,
    'builtin-stereo-widener': SPACE,
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

function rowOf(deviceType: string): DeviceDimension | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : PERCEPTUAL_DIMENSION_BY_DEVICE_TYPE[builtinType];
}

/** The dimension one device type shapes as a whole, or null for a type that shapes neither (or is not built in). */
export function readPerceptualDimensionOfDeviceType(deviceType: string): PerceptualExcludedDimension | null {
    return rowOf(deviceType)?.dimension ?? null;
}

/** The dimension every parameter write on this device type edits, or null when only some writes do. */
export function readDimensionEditedByEveryWrite(deviceType: string): PerceptualExcludedDimension | null {
    const row = rowOf(deviceType);
    return row?.writes === 'every-parameter' ? row.dimension : null;
}
