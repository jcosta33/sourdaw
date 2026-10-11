import { describe, expect, it, vi } from 'vitest';

import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';

import { syncGrinderPatchToAudio } from '../../useCases/grinderParamBridge/syncGrinderPatchToAudio';
import { grinderNeuralProfileParams } from '../GrinderNeuralProfileParams';
import {
    DEFAULT_PATCH,
    type GrinderImportedNeuralModel,
    type GrinderNeuralModel,
    type GrinderNeuralProfile,
} from '../GrinderPatch';
import { applyGrinderProjectParameters, GRINDER_PROJECT_PARAM_KEYS } from '../GrinderProjectParameterMap';

const IMPORTED_PROFILE: GrinderNeuralProfile = {
    derivedFrom: 'nam',
    sourceArchitecture: 'lstm',
    sourceSampleRate: 48_000,
    sourceWeightCount: 18,
    preferredTier: 'lite',
    inputDrive: 1.2,
    asymmetry: -0.1,
    outputTrim: 0.9,
    contourMix: 0.3,
    recurrentBias: 0.05,
    convWeights: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
    ],
    model: null,
    modelDigest: null,
};

function importedLibraryEntry(): GrinderImportedNeuralModel {
    return {
        id: 'imported-test-capture-abc123',
        source: 'imported',
        name: 'Test Capture',
        family: 'NAM import • lstm',
        placement: 'amp-capture',
        description: 'Imported from test.nam',
        importedAt: 0,
        sourceFileName: 'test.nam',
        sourceFileText: '{}',
        profile: IMPORTED_PROFILE,
    };
}

/**
 * What `persistDeviceParam`'s spread-and-append produces from the bridge's
 * persist calls: first insertion follows call order, later writes update in
 * place.
 */
function recordFromPersistCalls(calls: ReadonlyArray<[string, string, number]>): Record<string, number> {
    const record: Record<string, number> = {};
    for (const [, key, value] of calls) {
        record[key] = value;
    }
    return record;
}

function persistRecordForImportedPatch(): Record<string, number> {
    const persist_device_param = vi.fn();
    syncGrinderPatchToAudio({
        patch: {
            ...DEFAULT_PATCH,
            neuralModelSource: 'imported',
            neuralModelId: 'imported-test-capture-abc123',
            neuralModelName: 'Test Capture',
            neuralModelProfile: IMPORTED_PROFILE,
        },
        ref: { trackId: 'track-1', deviceId: 'device-1' },
        persist_device_param,
        update_device_param: vi.fn(),
        update_device_patch: vi.fn(),
        resolve_eligible_device_write_target: () => ({ status: 'eligible', trackId: 'track-1', deviceId: 'device-1' }),
    });
    return recordFromPersistCalls(persist_device_param.mock.calls as Array<[string, string, number]>);
}

describe('Grinder project parameter projection', () => {
    it('contains every descriptor-backed control in the serialized patch contract', () => {
        const descriptorKeys = getAutomationDeviceDescriptor('grinder')?.parameters.map((parameter) => parameter.id);
        expect(GRINDER_PROJECT_PARAM_KEYS).toEqual(expect.arrayContaining(descriptorKeys ?? []));
    });
    it('decodes flat and nested project values with the engine coercion laws', () => {
        const importedPatch = { ...DEFAULT_PATCH, neuralModelSource: 'imported' as const, neuralModelId: 'custom' };
        const projected = applyGrinderProjectParameters(importedPatch, {
            cabType: 1.5,
            neuralCpuBudget: 1.5,
            neuralModelMode: 1,
            neuralModelSlot: 2,
        });

        expect(projected).toMatchObject({ cabType: 'both', neuralCpuBudget: 2, neuralModelId: 'custom' });
    });

    it('refuses to reconstruct an imported capture from a partial neuralCustom* record (issue #4146 corrupt-record oracle)', () => {
        const values: Record<string, number> = { neuralModelMode: 1, neuralCustomTier: 1, neuralCustomInputDrive: 1.2 };
        // Today this oracle returns source 'builtin' with a null profile; a
        // partial scalar set stays there because fabricating the missing
        // neural scalars would be a silent fallback — the record is corrupt,
        // not incomplete.
        const projected = applyGrinderProjectParameters(DEFAULT_PATCH, values);
        expect(projected.neuralModelSource).toBe('builtin');
        expect(projected.neuralModelProfile).toBeNull();
    });

    it('restores an imported capture across a sync → persist → project-reload round trip', () => {
        const record = persistRecordForImportedPatch();

        // The record really carries the capture: mode, scalars, conv weights.
        expect(record.neuralModelMode).toBe(1);
        for (const [name, value] of grinderNeuralProfileParams(IMPORTED_PROFILE)) {
            expect(record[name]).toBe(value);
        }

        // Reload onto a fresh device: the rebuilt patch is the imported model
        // again — same audible identity, same conv weights — instead of the
        // 'builtin' null-profile fallback the projection used to produce.
        const reloaded = applyGrinderProjectParameters(DEFAULT_PATCH, record);
        expect(reloaded.neuralModelSource).toBe('imported');
        expect(reloaded.neuralModelProfile).not.toBeNull();
        expect(grinderNeuralProfileParams(reloaded.neuralModelProfile!)).toEqual(
            grinderNeuralProfileParams(IMPORTED_PROFILE)
        );
    });

    it('re-resolves identity from a library entry with an equal profile', () => {
        const record = persistRecordForImportedPatch();
        const entry = importedLibraryEntry();

        const reloaded = applyGrinderProjectParameters(DEFAULT_PATCH, record, [entry]);

        expect(reloaded.neuralModelId).toBe(entry.id);
        expect(reloaded.neuralModelName).toBe(entry.name);
        expect(reloaded.neuralModelFamily).toBe(entry.family);
        // The match adopts the entry's full profile, provenance included.
        expect(reloaded.neuralModelProfile).toEqual(entry.profile);
    });

    it('restores the full model from the library entry when the record proves the digest (#3774)', () => {
        // A real capture: the profile carries the complete model, the record
        // carries the scalar door plus the digest words. The model itself is
        // too large for the numeric record — it lives in the library entry.
        const model: GrinderNeuralModel = {
            architecture: 'WaveNet',
            version: '0.5.4',
            sampleRate: 48_000,
            config: { head_scale: 0.02, head: null, layers: [{ input_size: 1, condition_size: 1 }] },
            weights: [0.5, -0.25, 0.125],
        };
        const profile_with_model: GrinderNeuralProfile = {
            ...IMPORTED_PROFILE,
            model,
            modelDigest: '0a1b-2c3d-4e5f-6071',
        };
        const entry: GrinderImportedNeuralModel = {
            ...importedLibraryEntry(),
            profile: profile_with_model,
        };
        const persist_device_param = vi.fn();
        syncGrinderPatchToAudio({
            patch: {
                ...DEFAULT_PATCH,
                neuralModelSource: 'imported',
                neuralModelId: entry.id,
                neuralModelName: entry.name,
                neuralModelProfile: profile_with_model,
            },
            ref: { trackId: 'track-1', deviceId: 'device-1' },
            persist_device_param,
            update_device_param: vi.fn(),
            update_device_patch: vi.fn(),
            resolve_eligible_device_write_target: () => ({
                status: 'eligible',
                trackId: 'track-1',
                deviceId: 'device-1',
            }),
        });
        const record = recordFromPersistCalls(persist_device_param.mock.calls as Array<[string, string, number]>);

        // The digest words ride the numeric record; the weights do not.
        for (const [name, value] of [
            ['neuralCustomModelDigest0', 0x0a1b],
            ['neuralCustomModelDigest1', 0x2c3d],
            ['neuralCustomModelDigest2', 0x4e5f],
            ['neuralCustomModelDigest3', 0x6071],
        ] as const) {
            expect(record[name]).toBe(value);
        }
        expect(record.neuralCustomConvWeight0_0).toBeTypeOf('number');

        // Reload with the library present: the digest re-matches the entry and
        // the patch restores the FULL model — not the derived substitute.
        const reloaded = applyGrinderProjectParameters(DEFAULT_PATCH, record, [entry]);
        expect(reloaded.neuralModelSource).toBe('imported');
        expect(reloaded.neuralModelProfile?.model).toEqual(model);
        expect(reloaded.neuralModelId).toBe(entry.id);

        // Without the library entry the patch degrades to the scalar profile
        // under the derived id (the model asset itself is gone).
        const orphaned = applyGrinderProjectParameters(DEFAULT_PATCH, record, []);
        expect(orphaned.neuralModelProfile?.model).toBeNull();
        expect(orphaned.neuralModelProfile?.modelDigest).toBe(profile_with_model.modelDigest);
    });

    it('falls back to a stable derived id and the panel fallback name without a library match', () => {
        const record = persistRecordForImportedPatch();

        const reloaded = applyGrinderProjectParameters(DEFAULT_PATCH, record);
        const again = applyGrinderProjectParameters(DEFAULT_PATCH, record);

        expect(reloaded.neuralModelId).toMatch(/^imported-patch-/);
        expect(reloaded.neuralModelId).toBe(again.neuralModelId);
        expect(reloaded.neuralModelName).toBe('Selected in this patch');
    });
});
