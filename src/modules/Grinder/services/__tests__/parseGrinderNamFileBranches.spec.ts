import { describe, it, expect } from 'vitest';

import { parseGrinderNamFile } from '../parseGrinderNamFile';

/**
 * Deep branch specs for parseGrinderNamFile. Every fixture is a *complete,
 * valid* model — the parser validates the whole file against the native
 * runtime's contract (per-architecture weight counts included) and rejects
 * anything else by name, so the fixtures here derive their weight arrays from
 * the same formula the validator applies.
 */

type WavenetLayerConfig = {
    input_size: number;
    condition_size: number;
    head_size: number;
    channels: number;
    kernel_size: number;
    dilations: number[];
    activation: string;
    gated: boolean;
    head_bias: boolean;
    bottleneck?: number;
};

function wavenetWeightCount(layers: WavenetLayerConfig[]): number {
    let count = 0;
    for (const layer of layers) {
        const bottleneck = layer.bottleneck ?? layer.channels;
        const out2 = layer.gated ? 2 * bottleneck : bottleneck;
        count += layer.input_size * layer.channels; // rechannel
        for (const _dilation of layer.dilations) {
            count += layer.channels * out2 * layer.kernel_size + out2; // conv
            count += layer.condition_size * out2; // mixin
            count += bottleneck * layer.channels + layer.channels; // layer1x1
        }
        count += bottleneck * layer.head_size + (layer.head_bias ? layer.head_size : 0); // head rechannel (k=1)
    }
    return count + 1; // head scale
}

let weight_seed = 0.7071;
function nextWeight(): number {
    weight_seed = Math.sin(weight_seed * 12.9898) * 43758.5453;
    return (weight_seed - Math.floor(weight_seed)) * 2 - 1;
}

function wavenetNam(options: {
    layers: WavenetLayerConfig[];
    version?: string;
    metadata?: Record<string, unknown>;
    config_sample_rate?: number;
    root_sample_rate?: number;
    weight_value?: () => number;
}): string {
    const count = wavenetWeightCount(options.layers);
    const value = options.weight_value ?? nextWeight;
    const nam: Record<string, unknown> = {
        architecture: 'WaveNet',
        config: {
            layers: options.layers,
            head: null,
            head_scale: 0.02,
        },
        weights: Array.from({ length: count }, () => value()),
        metadata: options.metadata ?? {},
    };
    if (options.version !== undefined) {
        nam.version = options.version;
    }
    if (options.config_sample_rate !== undefined) {
        (nam.config as Record<string, unknown>).sample_rate = options.config_sample_rate;
    }
    if (options.root_sample_rate !== undefined) {
        nam.sample_rate = options.root_sample_rate;
    }
    return JSON.stringify(nam);
}

const SMALL_LAYER: WavenetLayerConfig = {
    input_size: 1,
    condition_size: 1,
    head_size: 1,
    channels: 1,
    kernel_size: 3,
    dilations: [1, 2],
    activation: 'Tanh',
    gated: false,
    head_bias: true,
};

function liteLayer(): WavenetLayerConfig[] {
    return [{ ...SMALL_LAYER, channels: 8, head_size: 1 }];
}

function standardLayer(): WavenetLayerConfig[] {
    return [{ ...SMALL_LAYER, channels: 8, dilations: [1, 2, 4, 8], head_size: 1 }];
}

function lstmNam(metadata: Record<string, unknown> = {}, hidden_size = 3): string {
    return JSON.stringify({
        version: '0.5.4',
        architecture: 'LSTM',
        config: { num_layers: 1, input_size: 1, hidden_size },
        sample_rate: 48_000,
        weights: Array.from(
            {
                length:
                    4 * hidden_size * (1 + hidden_size) + 4 * hidden_size + hidden_size + hidden_size + hidden_size + 1,
            },
            nextWeight
        ),
        metadata,
    });
}

function makeNam(metadata: Record<string, unknown> = {}, layers: WavenetLayerConfig[] = [SMALL_LAYER]): string {
    return wavenetNam({ layers, metadata });
}

function parse(text: string, fileName = 'test.nam'): ReturnType<typeof parseGrinderNamFile> {
    return parseGrinderNamFile({ file_name: fileName, file_text: text });
}

describe('parseGrinderNamFile — derive_preferred_tier branches', () => {
    it('returns recurrent for LSTM captures', () => {
        const result = parse(lstmNam({ name: 'Test' }));
        expect(result.profile.preferredTier).toBe('recurrent');
    });

    it('returns nano when weight_count < 256', () => {
        const result = parse(makeNam({}, [SMALL_LAYER]));
        expect(result.profile.model?.weights.length).toBeLessThan(256);
        expect(result.profile.preferredTier).toBe('nano');
    });

    it('returns lite when 256 <= weight_count < 1024', () => {
        const result = parse(makeNam({}, liteLayer()));
        const count = result.profile.model?.weights.length ?? 0;
        expect(count).toBeGreaterThanOrEqual(256);
        expect(count).toBeLessThan(1024);
        expect(result.profile.preferredTier).toBe('lite');
    });

    it('returns standard when weight_count >= 1024', () => {
        const result = parse(makeNam({}, standardLayer()));
        expect(result.profile.model?.weights.length).toBeGreaterThanOrEqual(1024);
        expect(result.profile.preferredTier).toBe('standard');
    });

    it('only real architectures parse: an LSTM-like unknown name is rejected, not tiered', () => {
        // Validation-not-substitute: "LSTM-net" was tiered recurrent by the
        // old name-sniffing parser while running a fake filter stack. Now the
        // file is refused outright.
        expect(() => parse(wavenetNam({ layers: [SMALL_LAYER] }).replace('"WaveNet"', '"LSTM-net"'))).toThrow(
            /Unsupported NAM architecture "LSTM-net"/
        );
    });
});

describe('parseGrinderNamFile — derive_placement branches', () => {
    it('returns rig-capture when tone_type contains "cab"', () => {
        const result = parse(makeNam({ tone_type: 'high-gain cab' }));
        expect(result.placement).toBe('rig-capture');
    });

    it('returns rig-capture when description contains "rig" (via modeled_by)', () => {
        const result = parse(makeNam({ tone_type: 'clean', modeled_by: 'rig test' }));
        expect(result.placement).toBe('rig-capture');
    });

    it('returns rig-capture when tone_type contains "room"', () => {
        const result = parse(makeNam({ tone_type: 'room ambience' }));
        expect(result.placement).toBe('rig-capture');
    });

    it('returns amp-capture when no rig/cab/room keyword is present', () => {
        const result = parse(makeNam({ tone_type: 'clean amp' }));
        expect(result.placement).toBe('amp-capture');
    });
});

describe('parseGrinderNamFile — derive_profile clamped output ranges', () => {
    it('inputDrive is always within [0.85, 1.55]', () => {
        // Very large weights → high RMS → inputDrive clamped to 1.55.
        const largeWeights = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 100 }));
        expect(largeWeights.profile.inputDrive).toBeLessThanOrEqual(1.55);
        expect(largeWeights.profile.inputDrive).toBeGreaterThanOrEqual(0.85);

        // Near-zero weights → low RMS → inputDrive near baseline.
        const smallWeights = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 0.001 }));
        expect(smallWeights.profile.inputDrive).toBeGreaterThanOrEqual(0.85);
        expect(smallWeights.profile.inputDrive).toBeLessThanOrEqual(1.55);
    });

    it('asymmetry is always within [-0.18, 0.18]', () => {
        const allPositive = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 10 }));
        expect(allPositive.profile.asymmetry).toBeLessThanOrEqual(0.18);
        expect(allPositive.profile.asymmetry).toBeGreaterThanOrEqual(-0.18);

        const allNegative = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => -10 }));
        expect(allNegative.profile.asymmetry).toBeGreaterThanOrEqual(-0.18);
    });

    it('asymmetry is positive for all-positive weights and negative for all-negative', () => {
        const positive = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 1 }));
        expect(positive.profile.asymmetry).toBeGreaterThan(0);

        const negative = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => -1 }));
        expect(negative.profile.asymmetry).toBeLessThan(0);
    });

    it('outputTrim is always within [0.72, 1.02]', () => {
        const highRms = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 50 }));
        expect(highRms.profile.outputTrim).toBeLessThanOrEqual(1.02);
        expect(highRms.profile.outputTrim).toBeGreaterThanOrEqual(0.72);

        const lowRms = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 0.001 }));
        expect(lowRms.profile.outputTrim).toBeGreaterThanOrEqual(0.72);
        expect(lowRms.profile.outputTrim).toBeLessThanOrEqual(1.02);
    });

    it('contourMix is always within [0.08, 0.32]', () => {
        const highEnergy = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 1 }));
        expect(highEnergy.profile.contourMix).toBeLessThanOrEqual(0.32);
        expect(highEnergy.profile.contourMix).toBeGreaterThanOrEqual(0.08);
    });

    it('contourMix includes a +0.05 tone_bias when tone_type contains "high"', () => {
        // Identical weights for both, so only the tone bias can differ.
        const weights = (): number => 0.1;
        const highTone = parse(
            wavenetNam({ layers: [SMALL_LAYER], weight_value: weights, metadata: { tone_type: 'high-gain' } })
        );
        const lowTone = parse(
            wavenetNam({ layers: [SMALL_LAYER], weight_value: weights, metadata: { tone_type: 'clean' } })
        );
        // The high-gain variant should have a higher contourMix by ~0.05.
        expect(highTone.profile.contourMix).toBeGreaterThan(lowTone.profile.contourMix);
        expect(highTone.profile.contourMix - lowTone.profile.contourMix).toBeCloseTo(0.05, 5);
    });

    it('recurrentBias is always within [-0.12, 0.12]', () => {
        const highBias = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 100 }));
        expect(highBias.profile.recurrentBias).toBeLessThanOrEqual(0.12);
        expect(highBias.profile.recurrentBias).toBeGreaterThanOrEqual(-0.12);
    });

    it('recurrentBias sign matches the sign of the weight mean', () => {
        const positive = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 1 }));
        expect(positive.profile.recurrentBias).toBeGreaterThan(0);

        const negative = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => -1 }));
        expect(negative.profile.recurrentBias).toBeLessThan(0);
    });
});

describe('parseGrinderNamFile — convWeights structure', () => {
    it('produces exactly 10 convWeight triples', () => {
        const result = parse(makeNam());
        expect(result.profile.convWeights).toHaveLength(10);
        for (const triple of result.profile.convWeights) {
            expect(Array.isArray(triple)).toBe(true);
            expect(triple).toHaveLength(3);
        }
    });

    it('each convWeight triple sums to at most 0.98 (scale normalization)', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER], weight_value: () => 0.5 }));
        for (const [left, center, right] of result.profile.convWeights) {
            const sum = left + center + right;
            expect(sum).toBeLessThanOrEqual(0.98 + 0.001);
        }
    });

    it('center weight is always larger than left and right', () => {
        const result = parse(makeNam());
        for (const [left, center, right] of result.profile.convWeights) {
            expect(center).toBeGreaterThan(left);
            expect(center).toBeGreaterThan(right);
        }
    });
});

describe('parseGrinderNamFile — weight validation', () => {
    it('rejects non-numeric weight entries by name instead of skipping them', () => {
        // The old parser silently dropped non-numbers and carried on with the
        // remainder; under validation-not-substitute the file is refused.
        const parsed = JSON.parse(wavenetNam({ layers: [SMALL_LAYER] })) as { weights: unknown[] };
        parsed.weights[3] = 'not-a-number';
        expect(() => parse(JSON.stringify(parsed))).toThrow(/weights must all be finite numbers/);
    });

    it('rejects a weight count that does not satisfy the declared architecture', () => {
        const text = wavenetNam({ layers: [SMALL_LAYER] }).replace(/"weights":\[/, '"weights":[0.1,');
        expect(() => parse(text)).toThrow(/architecture expects \d+ weights but the file carries \d+/);
    });

    it('carries the complete model: every weight, the config, and the architecture', () => {
        const result = parse(makeNam({}, liteLayer()));
        expect(result.profile.model).not.toBeNull();
        expect(result.profile.model?.architecture).toBe('WaveNet');
        expect(result.profile.model?.version).toBeNull();
        expect(result.profile.modelDigest).not.toBeNull();
        // The issue's probe: swapping two weights changes the identity, so
        // distinct captures can no longer collapse to one profile.
        const original_text = wavenetNam({ layers: liteLayer() });
        const parsed = JSON.parse(original_text) as { weights: number[] };
        const swapped = structuredClone(parsed);
        [swapped.weights[0], swapped.weights[1]] = [swapped.weights[1]!, swapped.weights[0]!];
        const other = parse(JSON.stringify(swapped));
        const original = parse(original_text);
        expect(other.profile.modelDigest).not.toBe(original.profile.modelDigest);
        expect(other.profile.model?.weights[0]).not.toBe(original.profile.model?.weights[0]);
    });

    it('retains the config: changing dilations changes the parsed model', () => {
        const original = parse(makeNam({}, [SMALL_LAYER]));
        const mutated_text = wavenetNam({
            layers: [{ ...SMALL_LAYER, dilations: [1, 1] }],
        });
        const mutated = parse(mutated_text);
        expect(mutated.profile.model?.config).not.toEqual(original.profile.model?.config);
        expect(mutated.profile.modelDigest).not.toBe(original.profile.modelDigest);
    });
});

describe('parseGrinderNamFile — error paths', () => {
    it('rejects invalid JSON with a descriptive message', () => {
        expect(() => parse('{ not json')).toThrow(/not valid JSON/);
    });

    it('rejects a JSON null payload', () => {
        expect(() => parse('null')).toThrow(/did not contain an object payload/);
    });

    it('rejects missing architecture', () => {
        expect(() =>
            parse(
                JSON.stringify({
                    weights: [0.1, 0.2],
                })
            )
        ).toThrow(/missing documented architecture\/weights data/);
    });

    it('rejects empty weights array', () => {
        expect(() =>
            parse(
                JSON.stringify({
                    architecture: 'WaveNet',
                    config: { layers: [] },
                    weights: [],
                })
            )
        ).toThrow(/missing documented architecture\/weights data/);
    });

    it('rejects empty-string architecture', () => {
        expect(() =>
            parse(
                JSON.stringify({
                    architecture: '   ',
                    weights: [0.1],
                })
            )
        ).toThrow(/missing documented architecture\/weights data/);
    });

    it('rejects an unsupported architecture by name', () => {
        expect(() =>
            parse(
                JSON.stringify({
                    architecture: 'CatLSTM',
                    config: { num_layers: 1, input_size: 1, hidden_size: 2 },
                    weights: [0.1],
                })
            )
        ).toThrow(/Unsupported NAM architecture "CatLSTM"/);
    });

    it('rejects an unsupported version by name', () => {
        const text = wavenetNam({ layers: [SMALL_LAYER], version: '0.4.2' });
        expect(() => parse(text)).toThrow(/Unsupported NAM file version "0\.4\.2"/);
    });

    it('accepts a supported legacy version', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER], version: '0.5.0' }));
        expect(result.profile.model?.version).toBe('0.5.0');
    });

    it('rejects a parametric (condition_dsp) capture by name', () => {
        const text = wavenetNam({ layers: [SMALL_LAYER] }).replace(
            '"head":null',
            '"head":null,"condition_dsp":{"architecture":"LSTM"}'
        );
        expect(() => parse(text)).toThrow(/condition_dsp \(parametric\) captures are not supported/);
    });
});

describe('parseGrinderNamFile — sample_rate fallback chain', () => {
    it('prefers the document-root sample_rate (NAMCore reads the root key)', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER], root_sample_rate: 44_100 }));
        expect(result.profile.sourceSampleRate).toBe(44_100);
    });

    it('falls back to metadata.sample_rate when the root omits it', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER], metadata: { sample_rate: 44_100 } }));
        expect(result.profile.sourceSampleRate).toBe(44_100);
    });

    it('falls back to config.sample_rate when root and metadata are absent', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER], config_sample_rate: 96_000 }));
        expect(result.profile.sourceSampleRate).toBe(96_000);
    });

    it('falls back to 48000 when no sample rate is recorded', () => {
        const result = parse(makeNam());
        expect(result.profile.sourceSampleRate).toBe(48_000);
    });
});

describe('parseGrinderNamFile — display name fallback', () => {
    it('uses metadata.name when present', () => {
        const result = parse(makeNam({ name: 'My Amp' }));
        expect(result.name).toBe('My Amp');
    });

    it('falls back to filename without extension when metadata.name is absent', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER] }), 'my-capture.nam');
        expect(result.name).toBe('my-capture');
    });

    it('falls back to filename for .json extension', () => {
        const result = parse(wavenetNam({ layers: [SMALL_LAYER] }), 'capture.json');
        expect(result.name).toBe('capture');
    });
});
