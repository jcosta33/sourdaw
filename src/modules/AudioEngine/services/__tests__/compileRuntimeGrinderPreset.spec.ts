import { describe, expect, it } from 'vitest';

import { GRINDER_PARAMETER_COUNT } from '../../models/GrinderRuntimeControl';
import { compileRuntimeGrinderPreset } from '../compileRuntimeGrinderPreset';

function createPreset(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        command: 'apply-grinder-preset',
        target: { trackId: 'guitar', deviceId: 'grinder-1', deviceType: 'grinder' },
        correlation: { workletGeneration: 7, controlSequence: 3 },
        scheduling: { targetFrame: null, deadlineFrame: null },
        parameters: [
            { parameterId: 'neuralEnabled', value: 1 },
            { parameterId: 'engineMode', value: 1 },
            { parameterId: 'cabIrSlot', value: 2 },
            { parameterId: 'ampModel', value: 4 },
            { parameterId: 'gain', value: 9 },
        ],
        overrides: [
            { parameterId: 'gain', value: 2.5 },
            { parameterId: 'engineMode', value: 2 },
        ],
        resetParameterIds: [],
        neural: { neuralModelMode: 'builtin' },
        ...overrides,
    };
}

describe('compileRuntimeGrinderPreset', () => {
    it('preserves scalar order and freezes a detached immediate preset', () => {
        const override = { parameterId: 'gain', value: 2.5 };
        const input = createPreset({ overrides: [override, { parameterId: 'engineMode', value: 2 }] });
        const before = structuredClone(input);
        const result = compileRuntimeGrinderPreset(input);

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled') {
            throw new Error(result.reason);
        }
        input.target.trackId = 'changed-track';
        input.correlation.controlSequence = 99;
        input.neural.neuralModelMode = 'imported';
        input.parameters.reverse();
        override.value = 8;

        expect(structuredClone(result.patch)).toEqual(before);
        expect(Object.isFrozen(result.patch)).toBe(true);
        expect(Object.isFrozen(result.patch.target)).toBe(true);
        expect(Object.isFrozen(result.patch.correlation)).toBe(true);
        expect(Object.isFrozen(result.patch.scheduling)).toBe(true);
        expect(Object.isFrozen(result.patch.resetParameterIds)).toBe(true);
        expect(Object.isFrozen(result.patch.neural)).toBe(true);
        for (const vector of [result.patch.parameters, result.patch.overrides]) {
            expect(Object.isFrozen(vector)).toBe(true);
            expect(vector.every(Object.isFrozen)).toBe(true);
        }
    });

    it('normalizes and freezes the imported scalar substitute without a model asset', () => {
        const weights = [0.25, 0.5, 0.75];
        const result = compileRuntimeGrinderPreset(
            createPreset({
                overrides: [],
                neural: { neuralModelMode: 'imported', profile: { inputDrive: 1.4, convWeights: [weights] } },
            })
        );

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.patch.neural.neuralModelMode !== 'imported') {
            throw new Error('Expected a compiled imported preset');
        }
        weights[0] = -0.5;

        expect(result.patch.overrides).toEqual([]);
        expect(result.patch.neural).toEqual({
            neuralModelMode: 'imported',
            profile: {
                preferredTier: 'standard',
                inputDrive: 1.4,
                asymmetry: null,
                outputTrim: null,
                contourMix: null,
                recurrentBias: null,
                convWeights: [[0.25, 0.5, 0.75]],
            },
        });
        expect(Object.isFrozen(result.patch.neural.profile)).toBe(true);
        expect(Object.isFrozen(result.patch.neural.profile.convWeights)).toBe(true);
        expect(Object.isFrozen(result.patch.neural.profile.convWeights[0])).toBe(true);
    });

    it('carries serialized NAM and its identity under the existing browser admission policy', () => {
        const model = {
            architecture: 'Linear',
            config: { receptive_field: 1, bias: false },
            weights: [0.5],
        };
        const modelJson = JSON.stringify(model).padEnd(1_048_577, ' ');
        const result = compileRuntimeGrinderPreset(
            createPreset({
                neural: {
                    neuralModelMode: 'imported',
                    profile: { model, modelDigest: '0123-4567-89ab-cdef' },
                    modelJson,
                },
            })
        );

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.patch.neural.neuralModelMode !== 'imported') {
            throw new Error('Expected a compiled model-carrying preset');
        }
        expect(result.patch.neural.modelJson).toBe(modelJson);
        expect(result.patch.neural.modelDigest).toBe('0123-4567-89ab-cdef');
        expect(result.patch.neural.profile).not.toHaveProperty('model');
    });

    it.each([
        ['a legacy command', { command: 'apply-grinder-neural-patch' }],
        ['an unexpected envelope field', { extra: true }],
        ['a different protocol version', { schemaVersion: 2 }],
        ['a non-Grinder target', { target: { trackId: 'guitar', deviceId: 'grinder-1', deviceType: 'bacteria' } }],
        ['a missing target ID', { target: { trackId: 'guitar', deviceType: 'grinder' } }],
        ['an oversized target ID', { target: { trackId: 'guitar', deviceId: 'x'.repeat(129), deviceType: 'grinder' } }],
        ['an extra target field', { target: { ...createPreset().target, parameterId: 'gain' } }],
        ['an invalid generation', { correlation: { workletGeneration: 0, controlSequence: 3 } }],
        [
            'an invalid sequence',
            { correlation: { workletGeneration: 7, controlSequence: Number.MAX_SAFE_INTEGER + 1 } },
        ],
        ['extra correlation data', { correlation: { ...createPreset().correlation, other: 1 } }],
        ['scheduled delivery', { scheduling: { targetFrame: 128, deadlineFrame: 256 } }],
        ['missing scheduling data', { scheduling: { targetFrame: null } }],
        ['a non-finite neural scalar', { neural: { neuralModelMode: 'imported', profile: { inputDrive: NaN } } }],
        ['legacy neural input', { neural: { type: 'patch', neuralModelMode: 'builtin' } }],
    ])('rejects %s without returning a postable message', (_name, mutation) => {
        expect(compileRuntimeGrinderPreset(createPreset(mutation))).toEqual({
            status: 'invalid',
            reason: expect.any(String),
        });
    });

    it.each([
        ['a missing value', { parameterId: 'bass' }],
        ['a non-finite value', { parameterId: 'bass', value: Infinity }],
        ['an extra scalar field', { parameterId: 'bass', value: 7, trackId: 'other' }],
        ['a duplicate scalar', { parameterId: 'gain', value: 1 }],
        ['a legacy unknown scalar', { parameterId: 'sag', value: 1 }],
        ['a project-only digest', { parameterId: 'neuralCustomModelDigest0', value: 1 }],
        ['project-only mic metadata', { parameterId: 'mic1Type', value: 1 }],
    ])('refuses the entire preset when a valid prefix is followed by %s', (_name, invalid) => {
        const parameters = [...createPreset().parameters, invalid];

        expect(compileRuntimeGrinderPreset(createPreset({ parameters }))).toEqual({
            status: 'invalid',
            reason: expect.any(String),
        });
    });

    it.each([
        ['a scalar outside the footprint', [{ parameterId: 'bass', value: 4 }]],
        [
            'duplicate overrides',
            [
                { parameterId: 'gain', value: 1 },
                { parameterId: 'gain', value: 2 },
            ],
        ],
        ['a non-finite override', [{ parameterId: 'gain', value: NaN }]],
        ['a malformed override', [null]],
    ])('refuses %s without returning the otherwise valid preset', (_name, overrides) => {
        expect(compileRuntimeGrinderPreset(createPreset({ overrides }))).toEqual({
            status: 'invalid',
            reason: expect.any(String),
        });
    });

    it('rejects oversized vectors before reading entries and refuses sparse vectors', () => {
        const parameters = Array.from({ length: GRINDER_PARAMETER_COUNT + 1 });
        Object.defineProperty(parameters, 0, {
            get() {
                throw new Error('An oversized vector must be refused before reading any element');
            },
        });

        expect(compileRuntimeGrinderPreset(createPreset({ parameters }))).toMatchObject({ status: 'invalid' });
        const sparseParameters = createPreset().parameters;
        sparseParameters.length += 1;
        expect(compileRuntimeGrinderPreset(createPreset({ parameters: sparseParameters }))).toMatchObject({
            status: 'invalid',
        });
    });

    it('admits a supported default restore only within the declared scalar footprint', () => {
        const preset = createPreset();
        const parameters = [...preset.parameters, { parameterId: 'gateAttack', value: 2 }];
        expect(compileRuntimeGrinderPreset({ ...preset, parameters, resetParameterIds: ['gateAttack'] })).toMatchObject(
            {
                status: 'compiled',
                patch: { resetParameterIds: ['gateAttack'] },
            }
        );
        for (const resetParameterIds of [
            ['gain'],
            ['gateRelease'],
            ['gateAttack', 'gateAttack'],
            ['transformerDrive'],
        ]) {
            expect(compileRuntimeGrinderPreset({ ...preset, parameters, resetParameterIds })).toMatchObject({
                status: 'invalid',
            });
        }
    });
});
