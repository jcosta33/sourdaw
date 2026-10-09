import { describe, expect, it } from 'vitest';

import {
    derivedGrinderNeuralModelId,
    grinderNeuralModelDigest,
    grinderNeuralProfileFromParamValues,
    grinderNeuralProfileParams,
    grinderNeuralProfilesEqual,
} from '../GrinderNeuralProfileParams';
import { type GrinderNeuralModel, type GrinderNeuralProfile } from '../GrinderPatch';

const FULL_MODEL: GrinderNeuralModel = {
    architecture: 'WaveNet',
    version: '0.5.4',
    sampleRate: 48_000,
    config: { head: null, head_scale: 0.02 },
    weights: [0.5, -0.25, 0.125, 0.0625],
};

function profileWithModel(model: GrinderNeuralModel): GrinderNeuralProfile {
    const scalars = buildProfile([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
    ]);
    return { ...scalars, model, modelDigest: grinderNeuralModelDigest(model) };
}

function buildProfile(convWeights: Array<[number, number, number]>): GrinderNeuralProfile {
    return {
        derivedFrom: 'nam',
        sourceArchitecture: 'wavenet',
        sourceSampleRate: 48_000,
        sourceWeightCount: convWeights.length * 3,
        preferredTier: 'lite',
        inputDrive: 1.2,
        asymmetry: -0.1,
        outputTrim: 0.9,
        contourMix: 0.3,
        recurrentBias: 0.05,
        convWeights,
        model: null,
        modelDigest: null,
    };
}

describe('grinderNeuralProfileParams', () => {
    it('should emit the exact ordered name/value list for a two-layer profile', () => {
        const profile = buildProfile([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
        ]);

        expect(grinderNeuralProfileParams(profile)).toEqual([
            ['neuralCustomTier', 1],
            ['neuralCustomInputDrive', 1.2],
            ['neuralCustomAsymmetry', -0.1],
            ['neuralCustomOutputTrim', 0.9],
            ['neuralCustomContourMix', 0.3],
            ['neuralCustomLstmBias', 0.05],
            ['neuralCustomConvWeight0_0', 0.1],
            ['neuralCustomConvWeight0_1', 0.2],
            ['neuralCustomConvWeight0_2', 0.3],
            ['neuralCustomConvWeight1_0', 0.4],
            ['neuralCustomConvWeight1_1', 0.5],
            ['neuralCustomConvWeight1_2', 0.6],
        ]);
    });

    // Rust's `BuiltinParamName` accepts only ASCII letters, digits, and
    // underscore, at most 40 bytes (crates/daw-engine `BuiltinParamName` rule).
    it('should emit only names matching the BuiltinParamName shape', () => {
        const profile = buildProfile([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
        ]);

        for (const [name] of grinderNeuralProfileParams(profile)) {
            expect(name).toMatch(/^[A-Za-z0-9_]{1,40}$/);
        }
    });

    it('should keep the longest conv-weight name within the 40-byte BuiltinParamName limit for ten layers', () => {
        const convWeights: Array<[number, number, number]> = Array.from({ length: 10 }, (_, layer) => [
            layer,
            layer + 0.1,
            layer + 0.2,
        ]);
        const profile = buildProfile(convWeights);

        const names = grinderNeuralProfileParams(profile).map(([name]) => name);
        const longest_length = Math.max(...names.map((name) => name.length));
        const longest_names = names.filter((name) => name.length === longest_length);

        // Every conv-weight name in this range shares one length (single-digit
        // layer and index), so the tie itself is the proof there is no longer
        // one hiding at a different layer or index.
        expect(longest_names).toContain('neuralCustomConvWeight9_2');
        expect(longest_length).toBe(25);
    });
});

describe('grinderNeuralModelDigest (#3774)', () => {
    it('changes when any single weight changes — the sampled-scalar collapse is gone', () => {
        const a = grinderNeuralModelDigest(FULL_MODEL);
        const swapped: GrinderNeuralModel = {
            ...FULL_MODEL,
            weights: [FULL_MODEL.weights[1]!, FULL_MODEL.weights[0]!, ...FULL_MODEL.weights.slice(2)],
        };
        const b = grinderNeuralModelDigest(swapped);
        expect(b).not.toBe(a);
    });

    it('is stable across identical models and distinguishes config/architecture/version', () => {
        expect(grinderNeuralModelDigest(FULL_MODEL)).toBe(grinderNeuralModelDigest(FULL_MODEL));
        expect(grinderNeuralModelDigest({ ...FULL_MODEL, config: { head: null, head_scale: 0.03 } })).not.toBe(
            grinderNeuralModelDigest(FULL_MODEL)
        );
        expect(grinderNeuralModelDigest({ ...FULL_MODEL, architecture: 'LSTM' })).not.toBe(
            grinderNeuralModelDigest(FULL_MODEL)
        );
        expect(grinderNeuralModelDigest({ ...FULL_MODEL, version: '0.5.0' })).not.toBe(
            grinderNeuralModelDigest(FULL_MODEL)
        );
    });
});

describe('grinderNeuralProfileParams — digest emission', () => {
    it('appends four digest words for a profile carrying a model', () => {
        const profile = profileWithModel(FULL_MODEL);
        const params = grinderNeuralProfileParams(profile);
        const digest_params = params.filter(([name]) => name.startsWith('neuralCustomModelDigest'));
        expect(digest_params).toHaveLength(4);
        for (const [, value] of digest_params) {
            expect(value).toBeTypeOf('number');
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(0xffff);
        }
    });

    it('emits no digest words for a legacy scalar-only profile', () => {
        const params = grinderNeuralProfileParams(buildProfile([[0.1, 0.2, 0.3]]));
        expect(params.some(([name]) => name.startsWith('neuralCustomModelDigest'))).toBe(false);
    });
});

describe('grinderNeuralProfileFromParamValues — digest reconstruction', () => {
    it('carries the digest (not the model) from a record that proves one', () => {
        const profile = profileWithModel(FULL_MODEL);
        const values: Record<string, number> = {};
        for (const [name, value] of grinderNeuralProfileParams(profile)) {
            values[name] = value;
        }
        const rebuilt = grinderNeuralProfileFromParamValues(values);
        expect(rebuilt).not.toBeNull();
        expect(rebuilt?.model).toBeNull();
        expect(rebuilt?.modelDigest).toBe(profile.modelDigest);
    });

    it('returns a null digest for legacy records without digest words', () => {
        const values: Record<string, number> = {};
        for (const [name, value] of grinderNeuralProfileParams(buildProfile([[0.1, 0.2, 0.3]]))) {
            values[name] = value;
        }
        const rebuilt = grinderNeuralProfileFromParamValues(values);
        expect(rebuilt?.modelDigest).toBeNull();
    });
});

describe('grinderNeuralProfilesEqual — digest precedence', () => {
    it('matches a record-derived profile to a full library entry by digest and only by digest', () => {
        const entry_profile = profileWithModel(FULL_MODEL);
        const record_profile: GrinderNeuralProfile = {
            ...entry_profile,
            model: null,
            sourceArchitecture: 'unknown',
            sourceSampleRate: 0,
            sourceWeightCount: 0,
        };
        expect(grinderNeuralProfilesEqual(record_profile, entry_profile)).toBe(true);
        // The scalars are identical, so only the digest can separate a
        // DIFFERENT capture that happens to share them.
        const other_capture = profileWithModel({ ...FULL_MODEL, weights: [1, 2, 3, 4] });
        expect(grinderNeuralProfilesEqual(record_profile, other_capture)).toBe(false);
    });

    it('falls back to scalar equality when either side predates digest records', () => {
        const legacy = buildProfile([[0.1, 0.2, 0.3]]);
        const same = buildProfile([[0.1, 0.2, 0.3]]);
        expect(grinderNeuralProfilesEqual(legacy, same)).toBe(true);
        const digested = profileWithModel(FULL_MODEL);
        expect(grinderNeuralProfilesEqual(legacy, digested)).toBe(false);
    });
});

describe('derivedGrinderNeuralModelId — digest participation', () => {
    it('derives distinct ids for records proving different digests', () => {
        const a: GrinderNeuralProfile = { ...buildProfile([[0.1, 0.2, 0.3]]), modelDigest: '0001-0002-0003-0004' };
        const b: GrinderNeuralProfile = { ...buildProfile([[0.1, 0.2, 0.3]]), modelDigest: '0001-0002-0003-0005' };
        expect(derivedGrinderNeuralModelId(a)).not.toBe(derivedGrinderNeuralModelId(b));
        expect(derivedGrinderNeuralModelId(a)).toBe(derivedGrinderNeuralModelId(b));
        const identical = profileWithModel(FULL_MODEL);
        expect(derivedGrinderNeuralModelId(a)).not.toBe(derivedGrinderNeuralModelId(identical));
    });
});
