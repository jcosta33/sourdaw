import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/**
 * The device panel a built-in device opens. Every kind except `yeast` names the
 * device instance the panel edits; Yeast's panel may open without one (its rack
 * state falls back to the selected track's Yeast device).
 */
export type DevicePanelKind =
    | 'fermenter'
    | 'toaster'
    | 'levain'
    | 'proofChamber'
    | 'gluten'
    | 'bacteria'
    | 'grinder'
    | 'proof'
    | 'scoring'
    | 'crust'
    | 'sampler'
    | 'grandBoule'
    | 'yeast';

/**
 * The panel of every built-in device type, or null for a device that opens no
 * panel. Exhaustive over the vocabulary, so a new built-in id fails to compile
 * here until someone decides its panel (ADR 0063).
 */
const DEVICE_PANEL_KIND_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: DevicePanelKind | null } = {
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
    fermenter: 'fermenter',
    toaster: 'toaster',
    levain: 'levain',
    'builtin-crumbs': 'sampler',
    'grand-boule': 'grandBoule',
    gluten: 'gluten',
    crust: 'crust',
    bacteria: 'bacteria',
    grinder: 'grinder',
    proof: 'proof',
    'dutch-oven': 'proofChamber',
    'native-scoring': 'scoring',
    knead: null,
    'transient-shaper': null,
    yeast: 'yeast',
    'drum-kit': null,
    synth: null,
};

/**
 * The panel a device type opens, or null when it opens none. A raw string
 * resolves through `resolveBuiltinDeviceType` first, so only an exact built-in
 * id can open a panel: a generated variant or a Faust or hosted device never does.
 */
export function devicePanelKindOf(deviceType: string): DevicePanelKind | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : DEVICE_PANEL_KIND_BY_DEVICE_TYPE[builtinType];
}
