import { describe, expect, it } from 'vitest';

import { validateGrinderNamModel } from '../validateGrinderNamModel';
import { waveNetWeightCount } from '../waveNetWeightCount';

/**
 * The runtime admission caps the WASM parser runs before building a WaveNet
 * (the plan it shares with native admission), asserted at import: each cap is
 * admitted at its ceiling and refused just over it, and the stock trainer
 * shapes still load. The Rust sweep
 * (`crates/daw-dsp/tests/grinder_wavenet_scratch_width_rejection.rs`) pins the
 * same shapes against native admission and the WASM parser.
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

const MONO_NESTED_HEAD = { out_channels: 1, kernel_size: 1, bias: false };

/** A `head_size` beside a nested head: the width the next array's channels
 * chain to, bounded like every other width. */
function headSizeBesideNestedHead(head_size: unknown): Layer {
    return { ...nestedHeadLayer(MONO_NESTED_HEAD), head_size };
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

function ones(length: number): number[] {
    return Array.from({ length }, () => 1);
}

/** Two arrays whose dilation lists hold `first` and `second` layers. */
function spread(first: number, second: number): Config {
    return config([layer({ head_size: 2, dilations: ones(first) }), layer({ input_size: 2, dilations: ones(second) })]);
}

function nested(levels: number): unknown {
    let value: unknown = 0;
    for (let level = 0; level < levels; level++) {
        value = [value];
    }
    return value;
}

/** Every JSON value in the tree, containers included, as the runtime scan counts them. */
function jsonValues(value: unknown): number {
    if (Array.isArray(value)) {
        return value.reduce((total: number, entry: unknown) => total + jsonValues(entry), 1);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value).reduce((total: number, entry: unknown) => total + jsonValues(entry), 1);
    }
    return 1;
}

const RUNTIME_LIMIT = /runtime/;

function expectRefused(cases: ReadonlyArray<readonly [string, Config]>): void {
    for (const [label, shape] of cases) {
        expect(() => validate(capture(shape)), label).toThrow(RUNTIME_LIMIT);
    }
}

function expectAdmitted(cases: ReadonlyArray<readonly [string, Config]>): void {
    for (const [label, shape] of cases) {
        expect(() => validate(capture(shape)), label).not.toThrow();
    }
}

describe('WaveNet runtime admission at import', () => {
    it('admits the stock trainer shapes, including the ones native refuses for per-sample work', () => {
        expectAdmitted([
            ['standard', stock(16, 8, 8)],
            ['lite', stock(12, 6, 6)],
            ['feather', stock(8, 4, 4)],
            ['nano', stock(4, 2, 2)],
        ]);
    });

    it('refuses a head_size beside a nested head that is not a positive integer', () => {
        expectRefused([
            ['head_size 0 beside a nested head', config([headSizeBesideNestedHead(0)])],
            ['string head_size beside a nested head', config([headSizeBesideNestedHead('1')])],
        ]);
    });

    it('admits every size cap at its ceiling and refuses it just over', () => {
        const arrays = (count: number): Config =>
            config([
                layer({ head_size: 2 }),
                ...Array.from({ length: count - 2 }, () => layer({ input_size: 2, head_size: 2 })),
                layer({ input_size: 2 }),
            ]);
        const post_head = (head: Layer): Config => config([layer({ head_size: 2 })], { ...POST_HEAD, ...head });
        const prelu = (slopes: number): Config =>
            config([
                layer({ activation: { type: 'PReLU', negative_slopes: Array.from({ length: slopes }, () => 0.25) } }),
            ]);
        expectRefused([
            ['dilation 32769', config([layer({ dilations: [32_769] })])],
            ['head_dilation 32769', config([nestedHeadLayer({ ...MONO_NESTED_HEAD, head_dilation: 32_769 })])],
            ['five layer arrays', arrays(5)],
            ['33 dilations in one array', config([layer({ dilations: ones(33) })])],
            ['33 layers across arrays', spread(17, 16)],
            ['channels 65', config([layer({ channels: 65 })])],
            ['bottleneck 65', config([layer({ bottleneck: 65 })])],
            ['gated width 66', config([layer({ gated: true, bottleneck: 33 })])],
            ['head_size 65', config([layer({ head_size: 65 })], POST_HEAD)],
            [
                'nested head out_channels 65',
                config([nestedHeadLayer({ ...MONO_NESTED_HEAD, out_channels: 65 })], POST_HEAD),
            ],
            ['head_size 65 beside a nested head', config([headSizeBesideNestedHead(65)])],
            ['head1x1 out_channels 65', config([layer({ head1x1: { active: true, out_channels: 65 } })])],
            ['kernel_size 10', config([layer({ kernel_size: 10 })])],
            ['kernel_sizes entry 10', config([layer({ kernel_sizes: [10] })])],
            ['post-stack head kernel 10', post_head({ kernel_sizes: [10] })],
            ['post-stack head with 9 kernels', post_head({ kernel_sizes: ones(9) })],
            ['post-stack head channels 65', post_head({ channels: 65 })],
            ['PReLU with 65 slopes', prelu(65)],
        ]);
        expectAdmitted([
            ['dilation 32768', config([layer({ dilations: [32_768] })])],
            ['head_dilation 32768', config([nestedHeadLayer({ ...MONO_NESTED_HEAD, head_dilation: 32_768 })])],
            ['four layer arrays', arrays(4)],
            ['32 dilations in one array', config([layer({ dilations: ones(32) })])],
            ['32 layers across arrays', spread(16, 16)],
            ['channels 64', config([layer({ channels: 64 })])],
            // Only an array reading 64 channels can take input_size 64.
            ['input_size 64', config([layer({ channels: 64, head_size: 2 }), layer({ input_size: 64 })])],
            ['bottleneck 64', config([layer({ bottleneck: 64 })])],
            ['gated width 64', config([layer({ gated: true, bottleneck: 32 })])],
            ['head_size 64', config([layer({ head_size: 64 })], POST_HEAD)],
            [
                'nested head out_channels 64',
                config([nestedHeadLayer({ ...MONO_NESTED_HEAD, out_channels: 64 })], POST_HEAD),
            ],
            ['head_size 64 beside a nested head', config([headSizeBesideNestedHead(64)])],
            ['head1x1 out_channels 64', config([layer({ head1x1: { active: true, out_channels: 64 } })])],
            ['kernel_size 9', config([layer({ kernel_size: 9 })])],
            ['kernel_sizes entry 9', config([layer({ kernel_sizes: [9] })])],
            ['post-stack head kernel 9', post_head({ kernel_sizes: [9] })],
            ['post-stack head with 8 kernels', post_head({ kernel_sizes: ones(8) })],
            ['post-stack head channels 64', post_head({ channels: 64 })],
            ['PReLU with 64 slopes', prelu(64)],
        ]);
    });

    it('admits the memory envelope at its ceiling and refuses it just over', () => {
        const single = (channels: number, kernel_size: number, dilation: number, activation = 'Tanh'): Config =>
            config([layer({ channels, kernel_size, dilations: [dilation], activation })]);
        // ReLU adds no transcendental work, so the 32-channel kernel-2 history
        // reaches the resident ceiling before the warm-up work ceiling.
        const resident = (dilation: number): Config => single(32, 2, dilation, 'ReLU');
        for (const [label, shape] of [
            // The resident charge reaches 8_388_768 bytes, 160 past 8 MiB.
            ['resident over 8 MiB', resident(32_597)],
            // The prewarm rounded up to 64 frames times the per-sample work passes 2^28.
            ['warm-up work over 2^28', single(16, 3, 32_000)],
            // A lookback of 65536 frames rounds the prewarm up to 65600.
            ['prewarm 65600', single(1, 3, 32_768)],
        ] as const) {
            expect(() => validate(capture(shape)), label).toThrow(/runtime memory budget/);
        }
        expectAdmitted([
            // 8_388_512 bytes, the last dilation under the ceiling.
            ['resident under 8 MiB', resident(32_596)],
            ['warm-up work under 2^28', single(16, 3, 31_999)],
            // A lookback of 65534 frames rounds the prewarm up to exactly 65536.
            ['prewarm 65536', single(1, 3, 32_767)],
        ]);
        // Neither the state ceiling nor the transient preparation envelope has
        // a case of its own. Every state float is also a resident float charged
        // 8 bytes, so state past 1_048_576 floats is already past 8 MiB
        // resident; and with every other cap held the transient peaks near
        // 21 MiB of its 32 MiB ceiling.
    });

    it('admits exactly 65536 weights and refuses 65537', () => {
        // 28 kernel-6 layers of 18 channels and a 25-wide biased head declare
        // exactly 65536 weights; 20 kernel-7 layers of 20 channels and a
        // 15-wide head declare 65537.
        const at_ceiling = config(
            [layer({ channels: 18, head_size: 25, head_bias: true, kernel_size: 6, dilations: ones(28) })],
            POST_HEAD
        );
        const over = config([layer({ channels: 20, head_size: 15, kernel_size: 7, dilations: ones(20) })], POST_HEAD);
        expect(waveNetWeightCount(at_ceiling)).toBe(65_536);
        expect(waveNetWeightCount(over)).toBe(65_537);
        expect(() => validate(capture(at_ceiling)), '65536 weights').not.toThrow();
        expect(() => validate(capture(over)), '65537 weights').toThrow(/65537 weights exceed the runtime/);
    });

    it('admits the runtime text scan limits at their ceiling and refuses them just over', () => {
        // About 49.9k weights: -1 / 3 serializes in 19 bytes and passes 1 MiB
        // with its comma; -1 / 3 / 1e7 serializes in 22 and does not.
        const large = config([layer({ channels: 64, kernel_size: 3, dilations: [1, 1, 1] })]);
        expect(() => validate(capture(large, -1 / 3)), 'model text under 1 MiB').not.toThrow();
        expect(() => validate(capture(large, -1 / 3 / 1e7)), 'model text over 1 MiB').toThrow(RUNTIME_LIMIT);

        // Three full notes and a fourth sized so the config text is `bytes` long.
        const config_of = (bytes: number): Config => {
            const with_notes = (last: number): Config =>
                config(
                    [layer()],
                    null,
                    Object.fromEntries(
                        Array.from({ length: 4 }, (_, index) => [
                            `notes${index}`,
                            'x'.repeat(index === 3 ? last : 4096),
                        ])
                    )
                );
            const shape = with_notes(bytes - JSON.stringify(with_notes(0)).length);
            expect(JSON.stringify(shape)).toHaveLength(bytes);
            return shape;
        };
        // The runtime text counts the root, the weights array (whose numbers
        // it does not count), architecture, version and sample rate, then the
        // config tree, padded here to `total` values.
        const values = (total: number): Config => {
            const base = config([layer()]);
            return { ...base, pad: Array.from({ length: total - 5 - jsonValues(base) - 1 }, () => 0) };
        };
        expectRefused([
            ['config one byte over 16 KiB', config_of(16_385)],
            ['4097 JSON values', values(4097)],
            // The config sits at depth 1, `pad` at 2, so 31 wrappers put the
            // innermost value at depth 33.
            ['nesting depth 33', config([layer()], null, { pad: nested(31) })],
            ['a 4097-byte string', config([layer()], null, { note: 'x'.repeat(4097) })],
            ['an escaped key', config([layer()], null, { 'a"b': 1 })],
            ['a number past f32', config([layer()], null, { pad: 1e39 })],
        ]);
        expectAdmitted([
            ['config of exactly 16 KiB', config_of(16_384)],
            ['4096 JSON values', values(4096)],
            ['nesting depth 32', config([layer()], null, { pad: nested(30) })],
            ['a 4096-byte string', config([layer()], null, { note: 'x'.repeat(4096) })],
            ['the largest finite f32', config([layer()], null, { pad: (2 - 2 ** -23) * 2 ** 127 })],
        ]);
        // The runtime text never carries root metadata or a repeated key: it
        // is serialized from the validated model.
    });

    it('admits a capture without config.head_scale and still needs its trailing weight', () => {
        // The runtimes take the head scale from the trailing weight and never
        // read config.head_scale.
        const without: Config = { layers: [layer()], head: null };
        const model = capture(without);
        expect(() => validate(model), 'no config.head_scale').not.toThrow();
        const short = { ...model, weights: (model.weights as number[]).slice(1) };
        expect(() => validate(short), 'trailing weight missing').toThrow(/expects \d+ weights/);
    });
});
