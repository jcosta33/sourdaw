import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_BAND, DEFAULT_PATCH, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { getBacteriaState, loadBacteriaPatch } from '../../../stores/bacteriaStore';
import { loadBacteriaPatchWithAudio } from '../loadBacteriaPatchWithAudio';

vi.mock('../../../stores/bacteriaStore', () => ({
    loadBacteriaPatch: vi.fn(),
    getBacteriaState: vi.fn(),
}));

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('../bacteriaParamBridgeDependencies', () => ({
    bacteriaParamBridgeDependencies: {},
}));

const getBacteriaStateMock = vi.mocked(getBacteriaState);

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

function makeDeps(parameterValues: Record<string, number> = {}) {
    return {
        getAllTracks: vi
            .fn()
            .mockReturnValue([{ id: TRACK_ID, devices: [{ id: DEVICE_ID, type: 'bacteria', parameterValues }] }]),
        updateDeviceParam: vi.fn(),
        persistDeviceParam: vi.fn(),
        resolveEligibleDeviceWriteTarget: vi.fn().mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        }),
    };
}

/** Engine pushes recorded as `[paramId, value]` pairs. */
function pushedParams(deps: ReturnType<typeof makeDeps>): Array<[string, number]> {
    return deps.updateDeviceParam.mock.calls.map((call) => [call[2] as string, call[3] as number]);
}

describe('loadBacteriaPatchWithAudio — engine sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: device not yet in the store → previous patch is DEFAULT_PATCH.
        getBacteriaStateMock.mockReturnValue({
            patch: { ...DEFAULT_PATCH },
            inputDb: -100,
            outputDb: -100,
            bandLevels: [0, 0, 0, 0, 0, 0],
            latency: 0,
            activeBand: 0,
            uiLevel: 1,
            activeModule: 'distortion',
        });
    });

    it('pushes lfo1Sync and lfo2Sync to the engine (the previously-omitted keys)', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = { ...DEFAULT_PATCH, lfo1Sync: true, lfo2Sync: true };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        const pushed = pushedParams(deps);
        expect(pushed).toContainEqual(['lfo1Sync', 1]);
        expect(pushed).toContainEqual(['lfo2Sync', 1]);
    });

    it('only pushes params that differ from the engine-mirrored previous patch', () => {
        const previous: BacteriaPatch = { ...DEFAULT_PATCH, mix: 0.5, outputGain: 3 };
        getBacteriaStateMock.mockReturnValue({
            patch: previous,
            inputDb: -100,
            outputDb: -100,
            bandLevels: [0, 0, 0, 0, 0, 0],
            latency: 0,
            activeBand: 0,
            uiLevel: 1,
            activeModule: 'distortion',
        });
        const deps = makeDeps();

        // Same bandCount (1) so band-diffing applies; only `mix` changes globally.
        const patch: BacteriaPatch = { ...previous, mix: 0.9 };
        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        const pushedKeys = pushedParams(deps).map(([key]) => key);
        expect(pushedKeys).toContain('mix');
        expect(pushedKeys).not.toContain('outputGain'); // unchanged → not re-sent
        expect(pushedKeys).not.toContain('inputGain'); // unchanged → not re-sent
    });

    it('unfreezes persisted project state even when the session store already matches the preset', () => {
        const deps = makeDeps({ band0_grainFreeze: 1 });
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            bands: [{ ...DEFAULT_BAND, granularEnabled: true, grainFreeze: false }, ...DEFAULT_PATCH.bands.slice(1)],
        };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        expect(pushedParams(deps)).toContainEqual(['band0_grainFreeze', 0]);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(DEVICE_ID, 'band0_grainFreeze', 0);
    });

    it('only iterates the active bandCount, not the full 6-entry band array', () => {
        const deps = makeDeps();
        // bandCount = 2 → bands 0 and 1 only.
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            bandCount: 2,
            bands: [
                { ...DEFAULT_BAND, drive: 10 },
                { ...DEFAULT_BAND, drive: 20 },
                { ...DEFAULT_BAND, drive: 30 },
                { ...DEFAULT_BAND, drive: 40 },
                { ...DEFAULT_BAND, drive: 50 },
                { ...DEFAULT_BAND, drive: 60 },
            ],
        };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        const pushedKeys = pushedParams(deps).map(([key]) => key);
        expect(pushedKeys).toContain('band0_drive');
        expect(pushedKeys).toContain('band1_drive');
        expect(pushedKeys).not.toContain('band2_drive'); // inactive band, never pushed
        expect(pushedKeys).not.toContain('band5_drive');
    });

    it('fully re-syncs a band that transitions from inactive to active (no stale-diff data loss)', () => {
        // Previous: bandCount 1 → only band 0 was active/pushed. Band 1 in the
        // store mirror carries a value the engine never received.
        const previous: BacteriaPatch = {
            ...DEFAULT_PATCH,
            bandCount: 1,
            bands: [{ ...DEFAULT_BAND }, { ...DEFAULT_BAND, drive: 77 }, ...DEFAULT_PATCH.bands.slice(2)],
        };
        getBacteriaStateMock.mockReturnValue({
            patch: previous,
            inputDb: -100,
            outputDb: -100,
            bandLevels: [0, 0, 0, 0, 0, 0],
            latency: 0,
            activeBand: 0,
            uiLevel: 1,
            activeModule: 'distortion',
        });
        const deps = makeDeps();

        // New: bandCount 2, band 1 drive equals the stale store value (77).
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            bandCount: 2,
            bands: [{ ...DEFAULT_BAND }, { ...DEFAULT_BAND, drive: 77 }, ...DEFAULT_PATCH.bands.slice(2)],
        };
        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        // Band 1 was previously inactive → every scalar param must be pushed
        // even though it matches the store mirror, because the engine never got it.
        expect(pushedParams(deps)).toContainEqual(['band1_drive', 77]);
    });

    it('never pushes the non-scalar metadata keys (name / modAssignments / snapshots / convolutionIr)', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            name: 'My Preset',
            modAssignments: [{ sourceId: 'lfo1', targetParam: 'drive', amount: 0.5, bipolar: true }],
            bands: [{ ...DEFAULT_BAND, convolutionIr: 'hall-a' }, ...DEFAULT_PATCH.bands.slice(1)],
        };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        const pushedKeys = pushedParams(deps).map(([key]) => key);
        expect(pushedKeys).not.toContain('name');
        expect(pushedKeys).not.toContain('modAssignments');
        expect(pushedKeys).not.toContain('snapshots');
        expect(pushedKeys).not.toContain('band0_convolutionIr');
    });

    it('still updates the store on load', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = { ...DEFAULT_PATCH, mix: 0.42 };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        expect(loadBacteriaPatch).toHaveBeenCalledWith(DEVICE_ID, patch);
    });
});
