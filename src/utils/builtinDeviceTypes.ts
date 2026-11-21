/**
 * The persisted vocabulary of built-in device types: every id the built-in
 * catalog creates, plus the legacy ids older projects and factory presets still
 * carry. Faust modules (`faust-*`, registered at runtime) and hosted plugins
 * (`external-plugin`) are not built-in vocabulary.
 *
 * These ids are wire values written into project files, so they never change.
 * The vocabulary names no module's language and holds no behaviour, which is why
 * it lives in `src/utils`: every module, pure layers included, may read it. What
 * a device *does* lives in the module that owns that behaviour, as one exhaustive
 * record over {@link BuiltinDeviceType}, so adding an id here fails compilation
 * in every such record until its row is decided (ADR 0063).
 */
export const BUILTIN_DEVICE_TYPES = [
    'builtin-eq',
    'builtin-compressor',
    'builtin-reverb',
    'builtin-delay',
    'builtin-gain',
    'builtin-sidechain-compressor',
    'builtin-chorus',
    'builtin-phaser',
    'builtin-distortion',
    'builtin-limiter',
    'builtin-flanger',
    'builtin-tremolo',
    'builtin-bitcrusher',
    'builtin-filter',
    'builtin-autopan',
    'builtin-convolution-reverb',
    'builtin-stereo-widener',
    'builtin-deesser',
    'builtin-lufs-meter',
    'builtin-synth',
    'builtin-synth-mellotron',
    'builtin-synth-strings',
    'builtin-synth-808bass',
    'builtin-synth-brass',
    'builtin-drum-kit',
    'builtin-drum-machine-808',
    'builtin-drum-machine-analog',
    'builtin-drum-machine-electronic',
    'builtin-drum-machine-acoustic',
    'fermenter',
    'toaster',
    'levain',
    'builtin-crumbs',
    'grand-boule',
    'gluten',
    'crust',
    'bacteria',
    'grinder',
    'proof',
    'dutch-oven',
    'native-scoring',
    'knead',
    'transient-shaper',
    'yeast',
    // Legacy ids with no catalog entry of their own: the bare drum kit factory
    // presets and older projects carry, and the built-in synth's original id.
    'drum-kit',
    'synth',
] as const;

export type BuiltinDeviceType = (typeof BUILTIN_DEVICE_TYPES)[number];

// A Set answers own membership only, so a raw string such as `constructor` or
// `__proto__` from a project file never resolves to an inherited member.
const BUILTIN_DEVICE_TYPE_SET: ReadonlySet<string> = new Set(BUILTIN_DEVICE_TYPES);

function isBuiltinDeviceType(raw: string): raw is BuiltinDeviceType {
    return BUILTIN_DEVICE_TYPE_SET.has(raw);
}

/**
 * Resolve a project's raw device-type string to its built-in vocabulary id, or
 * null when it is not a built-in device (a Faust module, a hosted plugin, an
 * unknown string).
 *
 * An exact id resolves to itself. A string in a generated variant family that the
 * catalog does not list resolves to the family's base: `builtin-drum-machine…` to
 * `builtin-drum-kit` and `builtin-synth…` to `builtin-synth`. The catalog builds
 * every variant from its base descriptor (`createDrumVariant`, `createSynthVariant`),
 * so every capability of a variant is its base's, and a variant saved by another
 * build still plays as its family. `knead` alone case-folds, because its native
 * factory matcher does and a project carrying `Knead` builds today
 * (see `resolveNativeDspDeviceType`).
 */
export function resolveBuiltinDeviceType(raw: string): BuiltinDeviceType | null {
    if (isBuiltinDeviceType(raw)) {
        return raw;
    }
    if (raw.startsWith('builtin-drum-machine')) {
        return 'builtin-drum-kit';
    }
    if (raw.startsWith('builtin-synth')) {
        return 'builtin-synth';
    }
    if (raw.toLowerCase() === 'knead') {
        return 'knead';
    }
    return null;
}
