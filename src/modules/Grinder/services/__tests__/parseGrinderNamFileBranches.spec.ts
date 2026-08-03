import { describe, it, expect } from 'vitest';

import { parseGrinderNamFile } from '../parseGrinderNamFile';

/**
 * Deep branch specs for parseGrinderNamFile. The existing spec only smoke-tests
 * name/source/family/length. These specs exercise the private derivation helpers
 * (derive_preferred_tier, derive_placement, derive_profile math) through the
 * public parseGrinderNamFile function.
 */

function makeNam(overrides: Record<string, unknown> = {}): string {
    const metadataOverride = (overrides.metadata as Record<string, unknown> | undefined) ?? {};
    return JSON.stringify({
        architecture: 'WaveNet',
        config: { sample_rate: 48_000 },
        weights: [0.14, -0.21, 0.32, 0.08, -0.11, 0.27, 0.19, -0.07, 0.25, 0.04, -0.03, 0.09],
        metadata: { name: 'Test', tone_type: 'capture', ...metadataOverride },
        ...overrides,
    });
}

function parse(text: string, fileName = 'test.nam'): ReturnType<typeof parseGrinderNamFile> {
    return parseGrinderNamFile({ file_name: fileName, file_text: text });
}

describe('parseGrinderNamFile — derive_preferred_tier branches', () => {
    it('returns recurrent for LSTM architectures regardless of weight count', () => {
        const result = parse(
            makeNam({
                architecture: 'LSTM-net',
                weights: Array.from({ length: 2000 }, (_, i) => i * 0.001),
            })
        );
        expect(result.profile.preferredTier).toBe('recurrent');
    });

    it('returns recurrent for architectures containing "recurrent"', () => {
        const result = parse(
            makeNam({
                architecture: 'recurrent_v2',
                weights: Array.from({ length: 2000 }, (_, i) => i * 0.001),
            })
        );
        expect(result.profile.preferredTier).toBe('recurrent');
    });

    it('returns nano when weight_count < 256', () => {
        const result = parse(
            makeNam({
                architecture: 'WaveNet',
                weights: Array.from({ length: 100 }, () => 0.1),
            })
        );
        expect(result.profile.preferredTier).toBe('nano');
    });

    it('returns lite when 256 <= weight_count < 1024', () => {
        const result = parse(
            makeNam({
                architecture: 'WaveNet',
                weights: Array.from({ length: 500 }, () => 0.1),
            })
        );
        expect(result.profile.preferredTier).toBe('lite');
    });

    it('returns standard when weight_count >= 1024', () => {
        const result = parse(
            makeNam({
                architecture: 'WaveNet',
                weights: Array.from({ length: 2000 }, () => 0.1),
            })
        );
        expect(result.profile.preferredTier).toBe('standard');
    });

    it('boundary: weight_count exactly 256 maps to lite (not nano)', () => {
        const result = parse(
            makeNam({
                architecture: 'WaveNet',
                weights: Array.from({ length: 256 }, () => 0.1),
            })
        );
        expect(result.profile.preferredTier).toBe('lite');
    });

    it('boundary: weight_count exactly 1024 maps to standard (not lite)', () => {
        const result = parse(
            makeNam({
                architecture: 'WaveNet',
                weights: Array.from({ length: 1024 }, () => 0.1),
            })
        );
        expect(result.profile.preferredTier).toBe('standard');
    });

    it('LSTM check is case-insensitive', () => {
        const result = parse(
            makeNam({
                architecture: 'lstm_model',
                weights: Array.from({ length: 2000 }, () => 0.1),
            })
        );
        expect(result.profile.preferredTier).toBe('recurrent');
    });
});

describe('parseGrinderNamFile — derive_placement branches', () => {
    it('returns rig-capture when tone_type contains "cab"', () => {
        const result = parse(makeNam({ metadata: { tone_type: 'high-gain cab' } }));
        expect(result.placement).toBe('rig-capture');
    });

    it('returns rig-capture when description contains "rig" (via modeled_by)', () => {
        const result = parse(makeNam({ metadata: { tone_type: 'clean', modeled_by: 'rig test' } }));
        expect(result.placement).toBe('rig-capture');
    });

    it('returns rig-capture when tone_type contains "room"', () => {
        const result = parse(makeNam({ metadata: { tone_type: 'room ambience' } }));
        expect(result.placement).toBe('rig-capture');
    });

    it('returns amp-capture when no rig/cab/room keyword is present', () => {
        const result = parse(makeNam({ metadata: { tone_type: 'clean amp' } }));
        expect(result.placement).toBe('amp-capture');
    });
});

describe('parseGrinderNamFile — derive_profile clamped output ranges', () => {
    it('inputDrive is always within [0.85, 1.55]', () => {
        // Very large weights → high RMS → inputDrive clamped to 1.55.
        const largeWeights = parse(makeNam({ weights: [100, -100, 100, -100, 100] }));
        expect(largeWeights.profile.inputDrive).toBeLessThanOrEqual(1.55);
        expect(largeWeights.profile.inputDrive).toBeGreaterThanOrEqual(0.85);

        // Near-zero weights → low RMS → inputDrive near baseline.
        const smallWeights = parse(makeNam({ weights: [0.001, -0.001, 0.001, -0.001, 0.001] }));
        expect(smallWeights.profile.inputDrive).toBeGreaterThanOrEqual(0.85);
        expect(smallWeights.profile.inputDrive).toBeLessThanOrEqual(1.55);
    });

    it('asymmetry is always within [-0.18, 0.18]', () => {
        const allPositive = parse(makeNam({ weights: [10, 10, 10, 10, 10] }));
        expect(allPositive.profile.asymmetry).toBeLessThanOrEqual(0.18);
        expect(allPositive.profile.asymmetry).toBeGreaterThanOrEqual(-0.18);

        const allNegative = parse(makeNam({ weights: [-10, -10, -10, -10, -10] }));
        expect(allNegative.profile.asymmetry).toBeGreaterThanOrEqual(-0.18);
    });

    it('asymmetry is positive for all-positive weights and negative for all-negative', () => {
        const positive = parse(makeNam({ weights: [1, 1, 1, 1, 1] }));
        expect(positive.profile.asymmetry).toBeGreaterThan(0);

        const negative = parse(makeNam({ weights: [-1, -1, -1, -1, -1] }));
        expect(negative.profile.asymmetry).toBeLessThan(0);
    });

    it('outputTrim is always within [0.72, 1.02]', () => {
        const highRms = parse(makeNam({ weights: [50, -50, 50, -50, 50] }));
        expect(highRms.profile.outputTrim).toBeLessThanOrEqual(1.02);
        expect(highRms.profile.outputTrim).toBeGreaterThanOrEqual(0.72);

        const lowRms = parse(makeNam({ weights: [0.001, -0.001, 0.001, -0.001, 0.001] }));
        expect(lowRms.profile.outputTrim).toBeGreaterThanOrEqual(0.72);
        expect(lowRms.profile.outputTrim).toBeLessThanOrEqual(1.02);
    });

    it('contourMix is always within [0.08, 0.32]', () => {
        const highEnergy = parse(makeNam({ weights: Array.from({ length: 30 }, () => 1) }));
        expect(highEnergy.profile.contourMix).toBeLessThanOrEqual(0.32);
        expect(highEnergy.profile.contourMix).toBeGreaterThanOrEqual(0.08);
    });

    it('contourMix includes a +0.05 tone_bias when tone_type contains "high"', () => {
        const highTone = parse(
            makeNam({ metadata: { tone_type: 'high-gain' }, weights: Array.from({ length: 30 }, () => 0.1) })
        );
        const lowTone = parse(
            makeNam({ metadata: { tone_type: 'clean' }, weights: Array.from({ length: 30 }, () => 0.1) })
        );
        // The high-gain variant should have a higher contourMix by ~0.05.
        expect(highTone.profile.contourMix).toBeGreaterThan(lowTone.profile.contourMix);
        expect(highTone.profile.contourMix - lowTone.profile.contourMix).toBeCloseTo(0.05, 5);
    });

    it('recurrentBias is always within [-0.12, 0.12]', () => {
        const highBias = parse(makeNam({ weights: [100, 100, 100, 100, 100] }));
        expect(highBias.profile.recurrentBias).toBeLessThanOrEqual(0.12);
        expect(highBias.profile.recurrentBias).toBeGreaterThanOrEqual(-0.12);
    });

    it('recurrentBias sign matches the sign of the weight mean', () => {
        const positive = parse(makeNam({ weights: [1, 2, 3, 4, 5] }));
        expect(positive.profile.recurrentBias).toBeGreaterThan(0);

        const negative = parse(makeNam({ weights: [-1, -2, -3, -4, -5] }));
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
        const result = parse(makeNam({ weights: Array.from({ length: 30 }, () => 0.5) }));
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

describe('parseGrinderNamFile — collect_weights nested array flattening', () => {
    it('flattens deeply nested weight arrays', () => {
        const result = parse(
            makeNam({
                weights: [[0.1, [0.2, [0.3, 0.4]]], [0.5, 0.6], 'not-a-number', 0.7, null, 0.8],
            })
        );
        // sourceWeightCount should be 8 (0.1..0.8), skipping non-finite.
        expect(result.profile.sourceWeightCount).toBe(8);
    });

    it('ignores non-numeric entries in a flat weights array', () => {
        const result = parse(
            makeNam({
                weights: [0.1, 'x', 0.2, null, undefined, 0.3, true, 0.4],
            })
        );
        expect(result.profile.sourceWeightCount).toBe(4);
    });
});

describe('parseGrinderNamFile — error paths', () => {
    it('rejects invalid JSON with a descriptive message', () => {
        expect(() => parse('{ not json')).toThrow(/not valid JSON/);
    });

    it('rejects a non-object JSON payload (e.g. a bare array) with missing-data error', () => {
        // Arrays pass the typeof === 'object' check but have no architecture/weights,
        // so they hit the missing-data branch rather than the payload-type branch.
        expect(() => parse('[1, 2, 3]')).toThrow(/missing documented architecture\/weights data/);
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
});

describe('parseGrinderNamFile — sample_rate fallback chain', () => {
    it('uses metadata.sample_rate when present', () => {
        const result = parse(makeNam({ metadata: { sample_rate: 44_100 } }));
        expect(result.profile.sourceSampleRate).toBe(44_100);
    });

    it('falls back to config.sample_rate when metadata.sample_rate is absent', () => {
        const result = parse(
            JSON.stringify({
                architecture: 'WaveNet',
                config: { sample_rate: 96_000 },
                weights: [0.1, 0.2, 0.3],
            })
        );
        expect(result.profile.sourceSampleRate).toBe(96_000);
    });

    it('falls back to 48000 when neither metadata nor config has sample_rate', () => {
        const result = parse(
            JSON.stringify({
                architecture: 'WaveNet',
                weights: [0.1, 0.2, 0.3],
            })
        );
        expect(result.profile.sourceSampleRate).toBe(48_000);
    });
});

describe('parseGrinderNamFile — display name fallback', () => {
    it('uses metadata.name when present', () => {
        const result = parse(makeNam({ metadata: { name: 'My Amp' } }));
        expect(result.name).toBe('My Amp');
    });

    it('falls back to filename without extension when metadata.name is absent', () => {
        const result = parse(
            JSON.stringify({
                architecture: 'WaveNet',
                weights: [0.1, 0.2, 0.3],
            }),
            'my-capture.nam'
        );
        expect(result.name).toBe('my-capture');
    });

    it('falls back to filename for .json extension', () => {
        const result = parse(
            JSON.stringify({
                architecture: 'WaveNet',
                weights: [0.1, 0.2, 0.3],
            }),
            'capture.json'
        );
        expect(result.name).toBe('capture');
    });
});
