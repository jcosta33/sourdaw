import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';
import { LEVAIN_CONTROLLER_DEFAULTS } from '#/utils/levainControllerDefaults';

import { type BuiltinDeviceNode } from './AudioEngineState';

/**
 * How a worklet instrument takes the controller moves stored clip playback posts.
 *
 * - `controlsKey` — the node control object that takes them.
 * - `moves` — what its moves are: `pedal-positions` (a sustain position and two
 *   latches, any other controller ignored) or `raw-controllers` (the controller
 *   byte and value as the wire carries them).
 * - `controllerDefaults` — the value each non-pedal controller returns to when
 *   stored playback moved it and no row is in force; empty when none does.
 */
export type StoredControllerHosting = Readonly<{
    controlsKey: keyof Pick<BuiltinDeviceNode, 'grandBouleControls' | 'levainControls'>;
    moves: 'pedal-positions' | 'raw-controllers';
    controllerDefaults: ReadonlyMap<number, number>;
}>;

/**
 * The stored-controller hosting of every built-in device type, or null for a
 * device that ignores stored controllers. Exhaustive over the vocabulary, so a
 * new built-in id fails to compile here until its row is decided (ADR 0063).
 */
const STORED_CONTROLLER_HOSTING_BY_DEVICE_TYPE: {
    readonly [Type in BuiltinDeviceType]: StoredControllerHosting | null;
} = {
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
    fermenter: null,
    toaster: null,
    levain: { controlsKey: 'levainControls', moves: 'raw-controllers', controllerDefaults: LEVAIN_CONTROLLER_DEFAULTS },
    'builtin-crumbs': null,
    'grand-boule': { controlsKey: 'grandBouleControls', moves: 'pedal-positions', controllerDefaults: new Map() },
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
 * The stored-controller hosting of one device type, or null for a device that
 * ignores stored controllers (a Faust module, a hosted plugin, an unknown string).
 */
export function resolveStoredControllerHosting(deviceType: string): StoredControllerHosting | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : STORED_CONTROLLER_HOSTING_BY_DEVICE_TYPE[builtinType];
}
