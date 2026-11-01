import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateGrinderNamModel } from '../validateGrinderNamModel';

/**
 * The rejection matrix for `validateGrinderNamModel`: every named refusal the
 * native runtime can produce, asserted on the TS side too, so an unsupported
 * or inconsistent file fails at import with its real reason — never a
 * substitute profile.
 */

const MINIMAL_WAVENET = {
    version: '0.5.4',
    architecture: 'WaveNet',
    config: {
        layers: [
            {
                input_size: 1,
                condition_size: 1,
                head_size: 1,
                channels: 2,
                kernel_size: 3,
                dilations: [1, 2],
                activation: 'Tanh',
                gated: false,
                head_bias: true,
            },
        ],
        head: null,
        head_scale: 0.02,
    },
    weights: Array.from({ length: 50 }, (_, index) => Math.sin(index + 1) * 0.25),
    sample_rate: 48_000,
};

function mutate(mutator: (value: Record<string, unknown>) => void): string {
    const parsed = structuredClone(MINIMAL_WAVENET) as unknown as Record<string, unknown>;
    mutator(parsed);
    return JSON.stringify(parsed);
}

function expectError(text: string, pattern: RegExp): void {
    expect(() => validateGrinderNamModel(JSON.parse(text), 'probe.nam')).toThrow(pattern);
}

const NAM_FIXTURES = resolve(
    fileURLToPath(import.meta.url),
    '../../../../../../crates/daw-dsp/src/grinder/nam/fixtures'
);

/** `[input_size, channels, head_size]` for one legacy-head layer array. */
type WaveNetArrayShape = readonly [number, number, number];

type WaveNetCaptureJson = {
    version: string;
    architecture: string;
    config: Record<string, unknown> & { layers: Array<Record<string, unknown>> };
    weights: number[];
    sample_rate: number;
};

/** A mono WaveNet over arrays with no head bias, kernel 1, one dilation,
 * ungated and layer1x1 active, with its exact weight count, and a single-conv
 * post-stack head when the last head is not mono. Each array's head width is
 * the legacy `head_size` key, or only the nested `head` object. */
function waveNetCapture(
    shapes: readonly WaveNetArrayShape[],
    heads: 'legacy' | 'nested' = 'legacy'
): WaveNetCaptureJson {
    let weight_count = 1;
    const layers = shapes.map(([input_size, channels, head_size]): Record<string, unknown> => {
        // Rechannel, dilated conv with bias, input mixin, layer1x1 with bias,
        // and the head rechannel fed by the bottleneck (channels).
        weight_count += input_size * channels + 2 * (channels * channels + channels) + channels + channels * head_size;
        const head_width =
            heads === 'legacy' ? { head_size } : { head: { out_channels: head_size, kernel_size: 1, bias: false } };
        return {
            input_size,
            condition_size: 1,
            channels,
            ...head_width,
            head_bias: false,
            kernel_size: 1,
            dilations: [1],
            activation: 'Tanh',
            gated: false,
        };
    });
    const last_head = shapes.at(-1)![2];
    let head: unknown = null;
    if (last_head !== 1) {
        weight_count += last_head + 1;
        head = { channels: 1, out_channels: 1, kernel_sizes: [1], activation: 'Tanh' };
    }
    return {
        version: '0.5.4',
        architecture: 'WaveNet',
        config: { layers, head, head_scale: 0.02 },
        weights: Array.from({ length: weight_count }, (_, index) => Math.sin(index + 1) * 0.25),
        sample_rate: 48_000,
    };
}

describe('validateGrinderNamModel', () => {
    it('accepts a complete valid WaveNet model and reports its provenance', () => {
        const model = validateGrinderNamModel(structuredClone(MINIMAL_WAVENET), 'probe.nam');
        expect(model.architecture).toBe('WaveNet');
        expect(model.version).toBe('0.5.4');
        expect(model.sampleRate).toBe(48_000);
        expect(model.weights).toHaveLength(50);
    });

    it('rejects unknown architectures by name', () => {
        for (const architecture of ['CatLSTM', 'FeatureWaveNet', 'SlimmableContainer', 'RNN']) {
            expectError(
                mutate((value) => (value.architecture = architecture)),
                /Unsupported NAM architecture "/
            );
        }
    });

    it('rejects versions outside the supported window by name', () => {
        expectError(
            mutate((value) => (value.version = '0.4.9')),
            /Unsupported NAM file version "0\.4\.9"/
        );
        expectError(
            mutate((value) => (value.version = '0.8.0')),
            /Unsupported NAM file version "0\.8\.0"/
        );
        expectError(
            mutate((value) => (value.version = '1.0.0')),
            /Unsupported NAM file version "1\.0\.0"/
        );
        expectError(
            mutate((value) => (value.version = 'garbage')),
            /Unsupported NAM file version "garbage"/
        );
        // Boundary versions of the window stay acceptable.
        for (const version of ['0.5.0', '0.7.0', '0.7.9']) {
            const model = validateGrinderNamModel(JSON.parse(mutate((value) => (value.version = version))), 'p.nam');
            expect(model.version).toBe(version);
        }
    });

    it('rejects a weight array that does not satisfy the declared architecture', () => {
        expectError(
            mutate((value) => (value.weights = (value.weights as number[]).slice(1))),
            /architecture expects 50 weights but the file carries 49/
        );
        expectError(
            mutate((value) => (value.weights = [...(value.weights as number[]), 0.5])),
            /architecture expects 50 weights but the file carries 51/
        );
    });

    it('rejects parametric (condition_dsp) and slimmable variants explicitly', () => {
        expectError(
            mutate((value) => {
                (value.config as Record<string, unknown>).condition_dsp = { architecture: 'LSTM' };
            }),
            /condition_dsp \(parametric\) captures are not supported/
        );
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.slimmable = { method: 'slice_channels_uniform' };
            }),
            /slimmable \(dynamic-channel\) captures are not supported/
        );
    });

    it('rejects FiLM, grouped convolutions, and unknown gating modes', () => {
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.conv_post_film = { active: true };
            }),
            /FiLM modulation \("conv_post_film"\) is not supported/
        );
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.groups_input = 4;
            }),
            /grouped WaveNet convolutions/
        );
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.gating_mode = 'turbo';
            }),
            /unknown gating_mode/
        );
    });

    it('rejects multi-array WaveNet chains whose channels do not line up', () => {
        const second_layer = {
            input_size: 1,
            condition_size: 1,
            head_size: 1,
            channels: 2,
            kernel_size: 3,
            dilations: [1],
            activation: 'Tanh',
            gated: false,
            head_bias: true,
        };
        expectError(
            mutate((value) => {
                const config = value.config as { layers: unknown[] };
                config.layers.push(structuredClone(second_layer));
            }),
            /input_size must equal the preceding array's channels/
        );
    });

    it('rejects an array that feeds another at a narrower channel count than the first array', () => {
        // #5981: array 1 feeds array 2 at one channel; the runtime carries
        // array outputs through scratch sized from array 0's two channels.
        expect(() =>
            validateGrinderNamModel(
                waveNetCapture([
                    [1, 2, 1],
                    [2, 1, 1],
                    [1, 1, 1],
                ]),
                'narrowing.nam'
            )
        ).toThrow(/layer array 1: channels must equal the first array's channels; only the final array may differ/);
    });

    it('rejects an array seeded with a head wider than its own head accumulation', () => {
        for (const shapes of [
            [
                [1, 2, 2],
                [2, 2, 3],
            ],
            [
                [1, 2, 2],
                [2, 2, 1],
                [2, 1, 1],
            ],
        ] satisfies WaveNetArrayShape[][]) {
            expect(() => validateGrinderNamModel(waveNetCapture(shapes), 'wide-head.nam')).toThrow(
                /head input size \(\d+\) must equal the widest array head_size \([23]\)/
            );
        }
    });

    it('accepts the WaveNet shapes native admission accepts', () => {
        const captures: unknown[] = [
            JSON.parse(readFileSync(resolve(NAM_FIXTURES, 'wavenet.nam'), 'utf8')),
            JSON.parse(readFileSync(resolve(NAM_FIXTURES, 'gated_wavenet_synthetic.nam'), 'utf8')),
            // Equal widths throughout, mono final head.
            waveNetCapture([
                [1, 2, 2],
                [2, 2, 2],
                [2, 2, 1],
            ]),
            // The final array may narrow: nothing reads its channels afterwards.
            waveNetCapture([
                [1, 2, 1],
                [2, 1, 1],
            ]),
            // A final head narrower than the heads before it.
            waveNetCapture([
                [1, 2, 2],
                [2, 2, 1],
            ]),
        ];
        for (const capture of captures) {
            expect(validateGrinderNamModel(capture, 'admitted.nam').architecture).toBe('WaveNet');
        }
    });

    it('accepts a multi-array WaveNet whose heads are given only as nested heads', () => {
        const capture = waveNetCapture(
            [
                [1, 2, 2],
                [2, 2, 1],
            ],
            'nested'
        );
        expect(validateGrinderNamModel(capture, 'nested-head.nam').architecture).toBe('WaveNet');
    });

    it('chains array channels to the legacy head_size when a nested head is also given', () => {
        // Native admission and the WASM parser match array 1's channels to
        // array 0's head_size (3) and its head accumulation to the nested
        // head width (2); array 1's head1x1 narrows its accumulation to fit.
        const capture = {
            version: '0.5.4',
            architecture: 'WaveNet',
            config: {
                layers: [
                    {
                        input_size: 1,
                        condition_size: 1,
                        channels: 2,
                        head_size: 3,
                        head_bias: false,
                        head: { out_channels: 2, kernel_size: 1, bias: false },
                        kernel_size: 1,
                        dilations: [1],
                        activation: 'Tanh',
                        gated: false,
                    },
                    {
                        input_size: 2,
                        condition_size: 1,
                        channels: 3,
                        head_size: 1,
                        head_bias: false,
                        head1x1: { active: true, out_channels: 2 },
                        kernel_size: 1,
                        dilations: [1],
                        activation: 'Tanh',
                        gated: false,
                    },
                ],
                head: null,
                head_scale: 0.02,
            },
            weights: Array.from({ length: 64 }, (_, index) => Math.sin(index + 1) * 0.25),
            sample_rate: 48_000,
        };
        expect(validateGrinderNamModel(capture, 'both-head-keys.nam').weights).toHaveLength(64);
    });

    it('rejects a first array that reads more than the mono input', () => {
        expect(() => validateGrinderNamModel(waveNetCapture([[2, 2, 1]]), 'wide-input.nam')).toThrow(
            /layer array 0: input_size must be 1/
        );
    });

    it('rejects a WaveNet whose input or output is not mono', () => {
        const headless = waveNetCapture([[1, 2, 2]]);
        headless.config.head = null;
        headless.weights.length -= 3;
        const stereo_head = waveNetCapture([[1, 2, 2]]);
        stereo_head.config.head = { channels: 1, out_channels: 2, kernel_sizes: [1], activation: 'Tanh' };
        stereo_head.weights.push(0.1, 0.1, 0.1);
        for (const capture of [headless, stereo_head]) {
            expect(() => validateGrinderNamModel(capture, 'stereo.nam')).toThrow(
                /multi-channel WaveNet output \(2 channels\)/
            );
        }
        for (const key of ['in_channels', 'out_channels']) {
            const capture = waveNetCapture([[1, 2, 1]]);
            capture.config[key] = 2;
            expect(() => validateGrinderNamModel(capture, 'stereo.nam')).toThrow(
                new RegExp(`multi-channel WaveNet \\(${key} = 2\\)`)
            );
        }
    });

    it('lets a gating_mode string decide over the legacy gated flag', () => {
        const none_over_gated = waveNetCapture([[1, 2, 1]]);
        none_over_gated.config.layers[0]!.gating_mode = 'none';
        none_over_gated.config.layers[0]!.gated = true;
        // A gating_mode that is not a string leaves the decision to gated.
        const flag_decides = waveNetCapture([[1, 2, 1]]);
        flag_decides.config.layers[0]!.gating_mode = 5;
        for (const capture of [none_over_gated, flag_decides]) {
            expect(validateGrinderNamModel(capture, 'gating.nam').weights).toHaveLength(capture.weights.length);
        }
    });

    it('refuses each WaveNet array rule native admission and the runtime enforce', () => {
        const cases: Array<[string, (layer: Record<string, unknown>, capture: WaveNetCaptureJson) => void, RegExp]> = [
            ['boolean FiLM key', (layer) => (layer.conv_pre_film = true), /FiLM modulation \("conv_pre_film"\)/],
            ['null FiLM key', (layer) => (layer.conv_pre_film = null), /FiLM modulation \("conv_pre_film"\)/],
            ['numeric FiLM key', (layer) => (layer.conv_pre_film = 3), /FiLM modulation \("conv_pre_film"\)/],
            [
                'unlisted FiLM key',
                (layer) => (layer.custom_film = { active: true }),
                /FiLM modulation \("custom_film"\)/,
            ],
            [
                'grouped inactive head1x1',
                (layer) => (layer.head1x1 = { active: false, groups: 2 }),
                /grouped head1x1 convolutions/,
            ],
            ['non-boolean gated', (layer) => (layer.gated = 'yes'), /gated must be a boolean/],
            [
                'non-boolean layer1x1 active',
                (layer) => (layer.layer1x1 = { active: 'no' }),
                /layer1x1 active must be a boolean/,
            ],
            [
                'non-boolean head1x1 active',
                (layer) => (layer.head1x1 = { active: 'yes', out_channels: 1 }),
                /head1x1 active must be a boolean/,
            ],
            [
                'unknown secondary activation',
                (layer, capture) => {
                    layer.gated = true;
                    layer.secondary_activation = 'Bogus';
                    // Gating doubles the dilated conv and the input mixin.
                    capture.weights.push(...Array.from({ length: 8 }, () => 0.1));
                },
                /requires a known secondary_activation/,
            ],
            ['non-object array head', (layer) => (layer.head = 5), /layer array head must be an object/],
        ];
        for (const [label, change, reason] of cases) {
            const capture = waveNetCapture([[1, 2, 1]]);
            change(capture.config.layers[0]!, capture);
            expect(() => validateGrinderNamModel(capture, `${label}.nam`), label).toThrow(reason);
        }

        const nested_without_head_bias = waveNetCapture([[1, 2, 1]], 'nested');
        delete nested_without_head_bias.config.layers[0]!.head_bias;
        expect(() => validateGrinderNamModel(nested_without_head_bias, 'nested.nam')).toThrow(
            /layer array requires head_bias/
        );
        const zero_head_dilation = waveNetCapture([[1, 2, 1]], 'nested');
        zero_head_dilation.config.layers[0]!.head = { out_channels: 1, kernel_size: 1, bias: false, head_dilation: 0 };
        expect(() => validateGrinderNamModel(zero_head_dilation, 'nested.nam')).toThrow(
            /head_dilation must be a positive integer/
        );
    });

    it('accepts the inactive and ungrouped array options native admission accepts', () => {
        const changes: Array<(layer: Record<string, unknown>, capture: WaveNetCaptureJson) => void> = [
            (layer) => {
                layer.conv_pre_film = false;
                layer.conv_post_film = { active: false };
            },
            (layer) => (layer.head1x1 = { active: false, groups: 1 }),
            (layer, capture) => {
                layer.gated = true;
                layer.secondary_activation = 'Tanh';
                capture.weights.push(...Array.from({ length: 8 }, () => 0.1));
            },
        ];
        for (const change of changes) {
            const capture = waveNetCapture([[1, 2, 1]]);
            change(capture.config.layers[0]!, capture);
            expect(validateGrinderNamModel(capture, 'admitted.nam').architecture).toBe('WaveNet');
        }
    });

    it('rejects unknown activations by name', () => {
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.activation = 'SwishTheFourth';
            }),
            /requires a known activation/
        );
    });

    it('rejects a slope-less PReLU the native runtime would panic applying', () => {
        // The runtime resolves a PReLU channel slope as
        // `slopes.get(channel).unwrap_or(slopes[0])`, so an empty slope array
        // panics on the first rendered sample. Import refuses the shape —
        // rejection-for-rejection with the native parser — and never stores it.
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.activation = { type: 'PReLU', negative_slopes: [] };
            }),
            /PReLU requires at least one negative slope/
        );
        // A bare "PReLU" carries no slopes at all — the native parser refuses
        // it, and so does the mirror.
        expectError(
            mutate((value) => {
                const config = value.config as { layers: Array<Record<string, unknown>> };
                config.layers[0]!.activation = 'PReLU';
            }),
            /PReLU requires negative_slope or negative_slopes/
        );
    });

    it('accepts a PReLU carrying slopes, in either documented shape', () => {
        for (const activation of [
            { type: 'PReLU', negative_slope: 0.1 },
            { type: 'PReLU', negative_slopes: [0.1, 0.2] },
        ]) {
            const model = validateGrinderNamModel(
                JSON.parse(
                    mutate((value) => {
                        const config = value.config as { layers: Array<Record<string, unknown>> };
                        config.layers[0]!.activation = activation;
                    })
                ),
                'probe.nam'
            );
            expect(model.architecture).toBe('WaveNet');
        }
    });

    it('accepts a complete valid LSTM model', () => {
        const model = validateGrinderNamModel(
            {
                version: '0.5.4',
                architecture: 'LSTM',
                config: { num_layers: 1, input_size: 1, hidden_size: 3 },
                weights: Array.from({ length: 70 }, (_, index) => Math.sin(index * 3.7) * 0.2),
                sample_rate: 48_000,
            },
            'lstm.nam'
        );
        expect(model.architecture).toBe('LSTM');
        expect(model.weights).toHaveLength(70);
    });

    it('rejects a stacked wide LSTM before it can reach the runtime', () => {
        expect(() =>
            validateGrinderNamModel(
                {
                    version: '0.5.4',
                    architecture: 'LSTM',
                    config: { num_layers: 2, input_size: 1, hidden_size: 2, out_channels: 1 },
                    weights: Array.from({ length: 83 }, () => 0),
                    sample_rate: 48_000,
                },
                'stacked-wide.nam'
            )
        ).toThrow(/stacked wide LSTM unsupported by current runtime/);
    });

    it('accepts a stacked single-hidden-unit LSTM', () => {
        const model = validateGrinderNamModel(
            {
                version: '0.5.4',
                architecture: 'LSTM',
                config: { num_layers: 2, input_size: 1, hidden_size: 1, out_channels: 1 },
                weights: Array.from({ length: 30 }, () => 0),
                sample_rate: 48_000,
            },
            'stacked-mono.nam'
        );
        expect(model.architecture).toBe('LSTM');
        expect(model.weights).toHaveLength(30);
    });

    it('rejects an LSTM whose weight array does not fit its cell layout', () => {
        expect(() =>
            validateGrinderNamModel(
                {
                    architecture: 'LSTM',
                    config: { num_layers: 1, input_size: 1, hidden_size: 4 },
                    weights: Array.from({ length: 70 }, () => 0.1),
                },
                'lstm.nam'
            )
        ).toThrow(/architecture expects \d+ weights but the file carries 70/);
    });

    it('accepts a complete valid ConvNet model and rejects negative batchnorm variances', () => {
        // Block layout (channels 2): 4 taps + mean(2) + var(2) + weight(2) +
        // bias(2) + eps, twice (dilations 1, 2), then the 3-weight head.
        const valid = {
            architecture: 'ConvNet',
            config: { channels: 2, dilations: [1, 2], batchnorm: true, activation: 'ReLU' },
            weights: [
                0.1,
                0.2,
                0.3,
                0.4, // block 0 conv taps (1 -> 2, kernel 2)
                0,
                0.5, // mean
                1,
                1, // var
                1,
                -1, // weight
                0,
                0, // bias
                0.01, // eps
                0.5,
                0.2,
                0.3,
                0.4,
                0.1,
                0.6,
                0.7,
                0.8, // block 1 conv taps (2 -> 2, kernel 2)
                0,
                0.2, // mean
                1,
                0.8, // var
                1,
                1, // weight
                0,
                0, // bias
                0.01, // eps
                0.5,
                0.2, // head weights
                -0.1, // head bias
            ],
        };
        expect(validateGrinderNamModel(structuredClone(valid), 'conv.nam').weights).toHaveLength(33);

        const corrupt = structuredClone(valid) as { weights: number[] };
        corrupt.weights[6] = -2; // block 0 running variance slot
        expect(() => validateGrinderNamModel(corrupt, 'conv.nam')).toThrow(
            /batchnorm running variance must be positive/
        );
    });

    it('rejects a Linear model whose sample rate the engine cannot honor', () => {
        const valid = {
            architecture: 'Linear',
            config: { receptive_field: 4, bias: true, in_channels: 1, out_channels: 1 },
            weights: [0.1, 0.2, 0.3, 0.4, 0.05],
            sample_rate: 96_000,
        };
        expect(() => validateGrinderNamModel(valid, 'ir.nam')).toThrow(
            /Linear capture recorded at a different sample rate/
        );
        const mono_48k = { ...valid, sample_rate: 48_000 };
        expect(validateGrinderNamModel(mono_48k, 'ir.nam').weights).toHaveLength(5);
    });

    it('rejects non-finite weights', () => {
        expectError(
            mutate((value) => {
                const weights = value.weights as number[];
                weights[7] = Number.NaN;
            }),
            /weights must all be finite numbers/
        );
    });
});
