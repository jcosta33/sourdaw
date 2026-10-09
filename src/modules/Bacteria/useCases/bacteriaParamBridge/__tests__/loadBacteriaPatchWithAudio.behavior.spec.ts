import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DEFAULT_BAND, DEFAULT_PATCH, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { getBacteriaState, loadBacteriaPatch } from '../../../stores/bacteriaStore';
import { createFlushParam } from '../createFlushParam';
import { paramBatcher } from '../helpers';
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
        updateDevicePatch: vi.fn(),
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

    it('never pushes the non-scalar metadata keys as scalar params (name / modAssignments / snapshots)', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            name: 'My Preset',
            modAssignments: [{ sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true }],
        };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        const pushedKeys = pushedParams(deps).map(([key]) => key);
        expect(pushedKeys).not.toContain('name');
        expect(pushedKeys).not.toContain('modAssignments');
        expect(pushedKeys).not.toContain('snapshots');
    });

    // A patch that names a body has to sound with it: the load pushes and
    // persists the band's body like any other band parameter, so the engine
    // plays it now and a reload replays it from the document.
    it('pushes and persists the body a patch names for each active band', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            bandCount: 2,
            bands: [
                { ...DEFAULT_BAND, convolutionIr: 'metal' },
                { ...DEFAULT_BAND, convolutionIr: 'ceramic' },
                ...DEFAULT_PATCH.bands.slice(2),
            ],
        };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        expect(pushedParams(deps)).toContainEqual(['band0_convolutionIr', 2]);
        expect(pushedParams(deps)).toContainEqual(['band1_convolutionIr', 0]);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(DEVICE_ID, 'band0_convolutionIr', 2);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(DEVICE_ID, 'band1_convolutionIr', 0);
    });

    // Loading a patch with no body over a band that had one has to switch the
    // body off, not leave the previous one sounding under the new patch.
    it('pushes no body when the loaded patch has none and the band had one', () => {
        getBacteriaStateMock.mockReturnValue({
            ...getBacteriaState(DEVICE_ID),
            patch: {
                ...DEFAULT_PATCH,
                bands: [{ ...DEFAULT_BAND, convolutionIr: 'wood' }, ...DEFAULT_PATCH.bands.slice(1)],
            },
        });
        const deps = makeDeps({ band0_convolutionIr: 1 });

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, DEFAULT_PATCH);

        expect(pushedParams(deps).filter(([key]) => key === 'band0_convolutionIr')).toEqual([
            ['band0_convolutionIr', -1],
        ]);
    });

    it('pushes the assignment table through the patch door as a wholesale replacement', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            modAssignments: [
                { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true },
                { sourceId: 'macro2', targetParam: 'mix', amount: 1, bipolar: false },
            ],
        };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        expect(deps.updateDevicePatch).toHaveBeenCalledTimes(1);
        expect(deps.updateDevicePatch).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, {
            modAssignments: [
                { sourceId: 0, targetParam: 16, amount: 50 },
                { sourceId: 7, targetParam: 0, amount: 1 },
            ],
        });
    });

    it('pushes an empty assignment table so a load drops the previous patch routings', () => {
        const deps = makeDeps();
        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, { ...DEFAULT_PATCH });

        expect(deps.updateDevicePatch).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, { modAssignments: [] });
    });

    it('still updates the store on load', () => {
        const deps = makeDeps();
        const patch: BacteriaPatch = { ...DEFAULT_PATCH, mix: 0.42 };

        loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);

        expect(loadBacteriaPatch).toHaveBeenCalledWith(DEVICE_ID, patch);
    });

    describe('pending knob-drag rAF after a patch load', () => {
        let rafQueue: FrameRequestCallback[];

        beforeEach(() => {
            paramBatcher.cancelAll();
            rafQueue = [];
            vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
                rafQueue.push(cb);
                return rafQueue.length;
            });
            vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
                rafQueue[id - 1] = () => {};
            });
        });

        afterEach(() => {
            paramBatcher.cancelAll();
            vi.unstubAllGlobals();
        });

        function flushAnimationFrames(): void {
            const queued = rafQueue;
            rafQueue = [];
            for (const cb of queued) {
                cb(0);
            }
        }

        // The same flush the drag path uses, so a surviving drag frame lands in
        // updateDeviceParam exactly as a real knob drag would.
        function dragFlushParam(deps: ReturnType<typeof makeDeps>) {
            return createFlushParam(
                deps.updateDeviceParam,
                deps.persistDeviceParam,
                deps.resolveEligibleDeviceWriteTarget
            );
        }

        it('cancels the loaded device key so updateDeviceParam receives the loaded value last', () => {
            const deps = makeDeps();
            const flushParam = dragFlushParam(deps);
            const patch: BacteriaPatch = { ...DEFAULT_PATCH, mix: 0.9 };

            // A knob drag scheduled its rAF frame; the load lands before it flushes.
            paramBatcher.schedule(`${DEVICE_ID}:mix`, { deviceId: DEVICE_ID, key: 'mix', value: 99 }, flushParam);

            loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);
            flushAnimationFrames();

            const mixValues = pushedParams(deps)
                .filter(([key]) => key === 'mix')
                .map(([, value]) => value);
            expect(mixValues.at(-1)).toBe(0.9);
        });

        it('leaves a drag pending on another device flushing', () => {
            const deps = makeDeps();
            const otherFlush = vi.fn();
            const patch: BacteriaPatch = { ...DEFAULT_PATCH, mix: 0.9 };

            paramBatcher.schedule('other-dev:mix', { deviceId: 'other-dev', key: 'mix', value: 99 }, otherFlush);

            loadBacteriaPatchWithAudio(deps as never)(DEVICE_ID, patch);
            flushAnimationFrames();

            expect(otherFlush).toHaveBeenCalledWith('other-dev:mix', {
                deviceId: 'other-dev',
                key: 'mix',
                value: 99,
            });
        });
    });
});
