import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PATCH,
    getGrinderSupportedChainOrder,
    isSupportedGrinderChainPedalType,
    migrateGrinderPatch,
    SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES,
    type GrinderMic,
    type GrinderNeuralProfile,
    type GrinderPedal,
    type GrinderSnapshot,
} from '../GrinderPatch';

describe('isSupportedGrinderChainPedalType', () => {
    it('should accept every type in the supported chain list', () => {
        for (const pedal_type of SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES) {
            expect(isSupportedGrinderChainPedalType(pedal_type)).toBe(true);
        }
    });

    it('should reject a pedal type outside the supported chain list', () => {
        expect(isSupportedGrinderChainPedalType('wah')).toBe(false);
        expect(isSupportedGrinderChainPedalType('noise-gate')).toBe(false);
        expect(isSupportedGrinderChainPedalType('not-a-real-type')).toBe(false);
    });
});

function make_pedal(type: string, id: string): GrinderPedal {
    return { id, type: type as GrinderPedal['type'], enabled: true, params: {} };
}

describe('getGrinderSupportedChainOrder', () => {
    it('should preserve first-seen order and append missing supported types by default', () => {
        const pedals = [make_pedal('fuzz', 'a'), make_pedal('overdrive', 'b')];

        expect(getGrinderSupportedChainOrder(pedals)).toEqual(['fuzz', 'overdrive', 'compressor', 'distortion']);
    });

    it('should drop unsupported pedal types entirely', () => {
        const pedals = [make_pedal('wah', 'a'), make_pedal('overdrive', 'b'), make_pedal('noise-gate', 'c')];

        expect(getGrinderSupportedChainOrder(pedals, { include_missing: false })).toEqual(['overdrive']);
    });

    it('should dedupe repeated supported types, keeping the first occurrence position', () => {
        const pedals = [make_pedal('overdrive', 'a'), make_pedal('fuzz', 'b'), make_pedal('overdrive', 'c')];

        expect(getGrinderSupportedChainOrder(pedals, { include_missing: false })).toEqual(['overdrive', 'fuzz']);
    });

    it('should return only present types when include_missing is false and the chain is empty', () => {
        expect(getGrinderSupportedChainOrder([], { include_missing: false })).toEqual([]);
    });

    it('should return the full default order when include_missing is not specified and the chain is empty', () => {
        expect(getGrinderSupportedChainOrder([])).toEqual([...SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES]);
    });
});

describe('migrateGrinderPatch', () => {
    it('should fill every field with defaults for an empty patch', () => {
        const migrated = migrateGrinderPatch({});

        expect(migrated).toEqual(DEFAULT_PATCH);
    });

    it('should infer hybrid engineMode from a legacy neuralEnabled flag when engineMode is absent', () => {
        const migrated = migrateGrinderPatch({ neuralEnabled: true });

        expect(migrated.engineMode).toBe('hybrid');
        expect(migrated.neuralEnabled).toBe(true);
    });

    it('should infer neuralEnabled from a non-circuit engineMode when neuralEnabled is absent', () => {
        const migrated = migrateGrinderPatch({ engineMode: 'capture' });

        expect(migrated.neuralEnabled).toBe(true);
        expect(migrated.engineMode).toBe('capture');
    });

    it('should keep neuralEnabled false for an explicit circuit engineMode with no legacy flag', () => {
        const migrated = migrateGrinderPatch({ engineMode: 'circuit' });

        expect(migrated.neuralEnabled).toBe(false);
    });

    it('should prefer an explicit engineMode over the legacy neuralEnabled flag', () => {
        const migrated = migrateGrinderPatch({ engineMode: 'circuit', neuralEnabled: true });

        // Explicit engineMode wins; neuralEnabled is only inferred from it, not vice versa,
        // once engineMode is present.
        expect(migrated.engineMode).toBe('circuit');
        expect(migrated.neuralEnabled).toBe(true);
    });

    it('should fall back to the default cabIrId when cabIrId is an empty string', () => {
        const migrated = migrateGrinderPatch({ cabIrId: '' });

        expect(migrated.cabIrId).toBe(DEFAULT_PATCH.cabIrId);
    });

    it('should keep a non-empty cabIrId as-is', () => {
        const migrated = migrateGrinderPatch({ cabIrId: '2x12-open' });

        expect(migrated.cabIrId).toBe('2x12-open');
    });

    it('should mark neuralModelSource as imported when a neural profile is present and source is absent', () => {
        const profile: GrinderNeuralProfile = {
            derivedFrom: 'nam',
            sourceArchitecture: 'WaveNet',
            sourceSampleRate: 48_000,
            sourceWeightCount: 4,
            preferredTier: 'standard',
            inputDrive: 1,
            asymmetry: 0,
            outputTrim: 1,
            contourMix: 0,
            recurrentBias: 0,
            convWeights: [[0.1, 0.2, 0.3]],
        };

        const migrated = migrateGrinderPatch({ neuralModelProfile: profile });

        expect(migrated.neuralModelSource).toBe('imported');
        expect(migrated.neuralModelProfile).toEqual(profile);
    });

    it('should deep clone the neural profile convWeights so mutating the source does not affect the migrated patch', () => {
        const profile: GrinderNeuralProfile = {
            derivedFrom: 'nam',
            sourceArchitecture: 'WaveNet',
            sourceSampleRate: 48_000,
            sourceWeightCount: 4,
            preferredTier: 'standard',
            inputDrive: 1,
            asymmetry: 0,
            outputTrim: 1,
            contourMix: 0,
            recurrentBias: 0,
            convWeights: [[0.1, 0.2, 0.3]],
        };

        const migrated = migrateGrinderPatch({ neuralModelProfile: profile });
        profile.convWeights[0]![0] = 999;

        expect(migrated.neuralModelProfile?.convWeights[0]?.[0]).toBe(0.1);
    });

    it('should keep neuralModelProfile null when no profile is supplied', () => {
        const migrated = migrateGrinderPatch({});

        expect(migrated.neuralModelProfile).toBeNull();
        expect(migrated.neuralModelSource).toBe(DEFAULT_PATCH.neuralModelSource);
    });

    it('should default a pedal missing its id to a positional id and preserve its params', () => {
        const migrated = migrateGrinderPatch({
            prePedals: [{ type: 'fuzz', enabled: true, params: { fuzz: 7 } } as Partial<GrinderPedal> as GrinderPedal],
        });

        expect(migrated.prePedals).toEqual([{ id: 'pedal-0', type: 'fuzz', enabled: true, params: { fuzz: 7 } }]);
    });

    it('should clone pedal params so mutating the source pedal does not affect the migrated patch', () => {
        const source_params = { drive: 3 };
        const migrated = migrateGrinderPatch({
            postPedals: [{ id: 'od-1', type: 'overdrive', enabled: true, params: source_params }],
        });

        source_params.drive = 99;

        expect(migrated.postPedals[0]?.params.drive).toBe(3);
    });

    it('should default a snapshot missing id and name to positional values and clone its records', () => {
        const source_overrides = { gain: 5 };
        const migrated = migrateGrinderPatch({
            snapshots: [
                {
                    paramOverrides: source_overrides,
                    bypassStates: { 'od-1': true },
                } as Partial<GrinderSnapshot> as GrinderSnapshot,
            ],
        });

        source_overrides.gain = 42;

        expect(migrated.snapshots).toEqual([
            { id: 'snapshot-0', name: 'Snapshot 1', paramOverrides: { gain: 5 }, bypassStates: { 'od-1': true } },
        ]);
    });

    it('should merge a partial mic1 with mic defaults rather than replacing it wholesale', () => {
        const migrated = migrateGrinderPatch({
            mic1: { gain: 6 } as GrinderMic,
        });

        expect(migrated.mic1).toEqual({ ...DEFAULT_PATCH.mic1, gain: 6 });
    });

    it('should merge a partial mic2 with its own defaults, independent of mic1', () => {
        const migrated = migrateGrinderPatch({
            mic2: { distance: 0.8 } as GrinderMic,
        });

        expect(migrated.mic2).toEqual({ ...DEFAULT_PATCH.mic2, distance: 0.8 });
    });

    it('should preserve an already-complete patch unchanged', () => {
        const complete = migrateGrinderPatch({ ...DEFAULT_PATCH, name: 'My Tone', gain: 8 });
        const migrated_again = migrateGrinderPatch(complete);

        expect(migrated_again).toEqual(complete);
    });
});
