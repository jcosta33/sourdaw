import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { devicePanelKindOf } from '../DevicePanelByDeviceType';

// Hand-written expectations: deliberately not derived from the table under test.
const EXPECTED_PANEL_KIND_BY_TYPE: Readonly<Record<string, string>> = {
    fermenter: 'fermenter',
    toaster: 'toaster',
    levain: 'levain',
    'dutch-oven': 'proofChamber',
    gluten: 'gluten',
    bacteria: 'bacteria',
    grinder: 'grinder',
    proof: 'proof',
    yeast: 'yeast',
    'native-scoring': 'scoring',
    crust: 'crust',
    'builtin-crumbs': 'sampler',
    'grand-boule': 'grandBoule',
};

// Every built-in vocabulary id, written out by hand so a new id must be decided here too.
const ALL_BUILTIN_IDS_BY_HAND: readonly string[] = [
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
    'drum-kit',
    'synth',
];

const NO_PANEL_BUILTIN_IDS: readonly string[] = ALL_BUILTIN_IDS_BY_HAND.filter(
    (id) => !Object.hasOwn(EXPECTED_PANEL_KIND_BY_TYPE, id)
);

const EDGE_STRINGS: readonly string[] = [
    'builtin-synth-unknown',
    'builtin-drum-machine-x',
    'Knead',
    'Yeast',
    'constructor',
    '__proto__',
    'toString',
    '',
    'faust-x',
    'external-plugin',
    'automation',
];

describe('devicePanelKindOf', () => {
    it.each(Object.entries(EXPECTED_PANEL_KIND_BY_TYPE))('maps %s to its panel kind %s', (deviceType, kind) => {
        expect(devicePanelKindOf(deviceType)).toBe(kind);
    });

    it.each(NO_PANEL_BUILTIN_IDS)('opens no panel for the built-in id %s', (deviceType) => {
        expect(devicePanelKindOf(deviceType)).toBeNull();
    });

    it.each(EDGE_STRINGS)('opens no panel for the raw string %j', (raw) => {
        expect(devicePanelKindOf(raw)).toBeNull();
    });

    it('decides every built-in vocabulary id: the hand-written list covers BUILTIN_DEVICE_TYPES', () => {
        const undecided = BUILTIN_DEVICE_TYPES.filter((type) => !ALL_BUILTIN_IDS_BY_HAND.includes(type));
        expect(undecided).toEqual([]);
    });
});
