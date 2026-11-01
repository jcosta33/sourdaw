import { describe, expect, it } from 'vitest';

import { validateGrinderNamModel } from '../validateGrinderNamModel';
import { waveNetWeightCount } from '../waveNetWeightCount';

/**
 * The runtime admission caps the WASM parser runs before building a WaveNet
 * (native admission's shared plan), asserted at import: each cap just over its
 * ceiling is refused here, and the stock trainer shapes still load. The Rust
 * sweep (`crates/daw-dsp/tests/grinder_wavenet_scratch_width_rejection.rs`)
 * pins the same shapes against native admission and the WASM parser.
 */

type Layer = Record<string, unknown>;
type Config = Record<string, unknown> & { layers: Layer[] };

function layer(overrides: Layer = {}): Layer {
    return {
        input_size: 1,
        condition_size: 1,
        channels: 2,
        head_size: 1,
        head_bias: false,
        kernel_size: 1,
        dilations: [1],
        activation: 'Tanh',
        gated: false,
        ...overrides,
    };
}

/** An array whose head width is given only by the nested `head` object. */
function nestedHeadLayer(head: Layer): Layer {
    const value = layer({ head });
    delete value.head_size;
    return value;
}

function config(layers: Layer[], head: unknown = null, extra: Record<string, unknown> = {}): Config {
    return { layers, head, head_scale: 0.02, ...extra };
}

const POST_HEAD = { channels: 1, out_channels: 1, kernel_sizes: [1], activation: 'Tanh' };

/** A capture carrying exactly the weights its config declares. */
function capture(model_config: Config, weight = 0.125): Record<string, unknown> {
    return {
        version: '0.5.4',
        architecture: 'WaveNet',
        config: model_config,
        weights: Array.from({ length: waveNetWeightCount(model_config) }, () => weight),
        sample_rate: 48_000,
    };
}

function validate(model: Record<string, unknown>): unknown {
    return validateGrinderNamModel(structuredClone(model), 'probe.nam');
}

function stock(first_channels: number, first_head: number, second_channels: number): Config {
    const dilations = Array.from({ length: 10 }, (_, power) => 2 ** power);
    return config([
        layer({ channels: first_channels, head_size: first_head, kernel_size: 3, dilations }),
        layer({
            input_size: first_channels,
            channels: second_channels,
            head_size: 1,
            head_bias: true,
            kernel_size: 3,
            dilations,
        }),
    ]);
}

/** Two arrays whose dilation lists hold `first` and `second` layers. */
function spread(first: number, second: number): Config {
    return config([
        layer({ head_size: 2, dilations: Array.from({ length: first }, () => 1) }),
        layer({ input_size: 2, dilations: Array.from({ length: second }, () => 1) }),
    ]);
}

function nested(levels: number): unknown {
    let value: unknown = 0;
    for (let level = 0; level < levels; level++) {
        value = [value];
    }
    return value;
}

const RUNTIME_LIMIT = /runtime/;

describe('WaveNet runtime admission at import', () => {
    it('admits the stock trainer shapes, including the ones native refuses for per-sample work', () => {
        for (const [label, shape] of [
            ['standard', stock(16, 8, 8)],
            ['lite', stock(12, 6, 6)],
            ['feather', stock(8, 4, 4)],
            ['nano', stock(4, 2, 2)],
        ] as const) {
            expect(() => validate(capture(shape)), label).not.toThrow();
        }
    });

    it('refuses every size cap just over its ceiling', () => {
        const five_arrays = config([
            layer({ head_size: 2 }),
            layer({ input_size: 2, head_size: 2 }),
            layer({ input_size: 2, head_size: 2 }),
            layer({ input_size: 2, head_size: 2 }),
            layer({ input_size: 2 }),
        ]);
        const cases: ReadonlyArray<readonly [string, Config]> = [
            ['dilation 32769', config([layer({ dilations: [32_769] })])],
            [
                'head_dilation 32769',
                config([nestedHeadLayer({ out_channels: 1, kernel_size: 1, bias: false, head_dilation: 32_769 })]),
            ],
            ['five layer arrays', five_arrays],
            ['33 dilations in one array', config([layer({ dilations: Array.from({ length: 33 }, () => 1) })])],
            ['33 layers across arrays', spread(17, 16)],
            ['channels 65', config([layer({ channels: 65 })])],
            ['bottleneck 65', config([layer({ bottleneck: 65 })])],
            ['gated width 66', config([layer({ gated: true, bottleneck: 33 })])],
            ['head_size 65', config([layer({ head_size: 65 })], POST_HEAD)],
            [
                'nested head out_channels 65',
                config([nestedHeadLayer({ out_channels: 65, kernel_size: 1, bias: false })], POST_HEAD),
            ],
            ['head1x1 out_channels 65', config([layer({ head1x1: { active: true, out_channels: 65 } })])],
            ['kernel_size 10', config([layer({ kernel_size: 10 })])],
            ['kernel_sizes entry 10', config([layer({ kernel_sizes: [10] })])],
            ['post-stack head kernel 10', config([layer({ head_size: 2 })], { ...POST_HEAD, kernel_sizes: [10] })],
            [
                'post-stack head with 9 kernels',
                config([layer({ head_size: 2 })], { ...POST_HEAD, kernel_sizes: Array.from({ length: 9 }, () => 1) }),
            ],
            ['post-stack head channels 65', config([layer({ head_size: 2 })], { ...POST_HEAD, channels: 65 })],
            [
                'PReLU with 65 slopes',
                config([
                    layer({ activation: { type: 'PReLU', negative_slopes: Array.from({ length: 65 }, () => 0.25) } }),
                ]),
            ],
        ];
        for (const [label, shape] of cases) {
            expect(() => validate(capture(shape)), label).toThrow(RUNTIME_LIMIT);
        }
        for (const [label, shape] of [
            [
                'four layer arrays',
                config([
                    layer({ head_size: 2 }),
                    layer({ input_size: 2, head_size: 2 }),
                    layer({ input_size: 2, head_size: 2 }),
                    layer({ input_size: 2 }),
                ]),
            ],
            ['32 layers across arrays', spread(16, 16)],
            ['dilation 32768', config([layer({ dilations: [32_768] })])],
            ['kernel_size 9', config([layer({ kernel_size: 9 })])],
        ] as const) {
            expect(() => validate(capture(shape)), label).not.toThrow();
        }
    });

    it('refuses the memory envelope just over its ceiling', () => {
        const wide = (dilation: number): Config =>
            config([layer({ channels: 32, kernel_size: 3, dilations: [dilation] })]);
        const narrow = (dilation: number): Config =>
            config([layer({ channels: 1, kernel_size: 3, dilations: [dilation] })]);
        // State 1_048_640; then state exactly at its ceiling with resident over
        // 8 MiB; then a prewarm that rounds up to 65600.
        for (const [label, shape] of [
            ['state over its ceiling', wide(16_384)],
            ['resident over 8 MiB', wide(16_383)],
            ['prewarm 65600', narrow(32_768)],
        ] as const) {
            expect(() => validate(capture(shape)), label).toThrow(/runtime memory budget/);
        }
        expect(() => validate(capture(narrow(32_767))), 'prewarm 65536').not.toThrow();
        // The transient preparation envelope has no case of its own: with every
        // other cap held it peaks near 21 MiB of its 32 MiB ceiling.
    });

    it('refuses the runtime text scan limits just over their ceiling', () => {
        // About 49.9k weights: 21 bytes each passes 1 MiB, 23 bytes each does not.
        const large = config([layer({ channels: 64, kernel_size: 3, dilations: [1, 1, 1] })]);
        expect(() => validate(capture(large, -0.12345678901234568)), 'model text under 1 MiB').not.toThrow();
        expect(() => validate(capture(large, -1.2345678901234567e-7)), 'model text over 1 MiB').toThrow(RUNTIME_LIMIT);
        // Four 64-channel kernel-3 layers declare 66433 weights, the nearest
        // whole shape past 65536 that no other cap refuses.
        const over_weights = config([layer({ channels: 64, kernel_size: 3, dilations: [1, 1, 1, 1] })]);
        expect(waveNetWeightCount(over_weights)).toBe(66_433);
        expect(() => validate(capture(over_weights)), '66433 weights').toThrow(/66433 weights exceed the runtime/);

        const notes = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`notes${index}`, 'x'.repeat(4096)]));
        const cases: ReadonlyArray<readonly [string, Config]> = [
            ['config over 16 KiB', config([layer()], null, notes)],
            ['over 4096 JSON values', config([layer()], null, { pad: Array.from({ length: 4096 }, () => 0) })],
            // The config sits at depth 1, `pad` at 2, so 31 wrappers put the
            // innermost value at depth 33.
            ['nesting depth 33', config([layer()], null, { pad: nested(31) })],
            ['a 4097-byte string', config([layer()], null, { note: 'x'.repeat(4097) })],
            ['an escaped key', config([layer()], null, { 'a"b': 1 })],
            ['a number past f32', config([layer()], null, { pad: 1e39 })],
        ];
        for (const [label, shape] of cases) {
            expect(() => validate(capture(shape)), label).toThrow(RUNTIME_LIMIT);
        }
        expect(() => validate(capture(config([layer()], null, { pad: nested(30) }))), 'depth 32').not.toThrow();
        expect(
            () => validate(capture(config([layer()], null, { note: 'x'.repeat(4096) }))),
            'a 4096-byte string'
        ).not.toThrow();
        // The runtime text never carries root metadata or a repeated key: it
        // is serialized from the validated model.
    });
});
