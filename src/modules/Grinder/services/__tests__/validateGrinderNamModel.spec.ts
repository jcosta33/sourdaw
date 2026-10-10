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
