import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/stores';

import { DEFAULT_BAND, DEFAULT_PATCH, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { type BacteriaState, setBacteriaBandParam } from '../../../stores/bacteriaStore';
import {
    type PersistDeviceParamFn,
    type ResolveEligibleDeviceWriteTargetFn,
    type UpdateDeviceParamFn,
} from '../helpers';
import { setBacteriaBandParamWithAudio } from '../setBacteriaBandParamWithAudio';

type ScheduledEntry = {
    deviceId: string;
    key: string;
    value: number;
};

type FlushParam = (compositeKey: string, entry: ScheduledEntry) => void;
type ScheduleParam = (compositeKey: string, entry: ScheduledEntry, flush: FlushParam) => void;
type SetBacteriaBandParamMock = (
    deviceId: string,
    bandIndex: number,
    key: keyof BacteriaPatch['bands'][0],
    value: BacteriaPatch['bands'][0][keyof BacteriaPatch['bands'][0]]
) => void;
type GetBacteriaStateMock = (deviceId: string) => BacteriaState;

const mocks = vi.hoisted(() => ({
    setBacteriaBandParam: vi.fn<SetBacteriaBandParamMock>(),
    getBacteriaState: vi.fn<GetBacteriaStateMock>(),
    schedule: vi.fn<ScheduleParam>((compositeKey, entry, flushParam) => {
        flushParam(compositeKey, entry);
    }),
    cancel: vi.fn<(key: string) => void>(),
    cancelAll: vi.fn<() => void>(),
}));

vi.mock('../../../stores/bacteriaStore', () => ({
    setBacteriaBandParam: mocks.setBacteriaBandParam,
    getBacteriaState: mocks.getBacteriaState,
}));

vi.mock('../helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../helpers')>();
    return {
        ...actual,
        paramBatcher: {
            schedule: mocks.schedule,
            cancel: mocks.cancel,
            cancelAll: mocks.cancelAll,
            get pendingSize() {
                return 0;
            },
        },
    };
});

type BridgeDeps = {
    getAllTracks: () => Track[];
    updateDeviceParam: UpdateDeviceParamFn;
    persistDeviceParam: PersistDeviceParamFn;
    resolveEligibleDeviceWriteTarget: ResolveEligibleDeviceWriteTargetFn;
};

function createTrackWithDevice(deviceId: string): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [{ id: deviceId, name: 'Bacteria', type: 'bacteria', bypassed: false, parameterValues: {} }],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function createTwoBandState(): BacteriaState {
    return {
        patch: {
            ...DEFAULT_PATCH,
            bands: [
                { ...DEFAULT_BAND, drive: 0 },
                { ...DEFAULT_BAND, drive: 0 },
            ],
        },
        inputDb: -100,
        outputDb: -100,
        bandLevels: [0, 0],
        latency: 0,
        activeBand: 0,
        uiLevel: 1,
        activeModule: 'distortion',
    };
}

function createDeps(tracks: Track[] = [createTrackWithDevice('device-1')]): BridgeDeps {
    const resolveEligibleDeviceWriteTarget = vi.fn<ResolveEligibleDeviceWriteTargetFn>((deviceId) => {
        const owner = tracks.find((track) => track.devices.some((device) => device.id === deviceId));
        if (owner === undefined) {
            return { status: 'missing' };
        }

        return { status: 'eligible', trackId: owner.id, deviceId };
    });

    return {
        getAllTracks: vi.fn(() => tracks),
        updateDeviceParam: vi.fn<UpdateDeviceParamFn>(),
        persistDeviceParam: vi.fn<PersistDeviceParamFn>(),
        resolveEligibleDeviceWriteTarget,
    };
}

describe('setBacteriaBandParamWithAudio', () => {
    const deviceId = 'device-1';

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getBacteriaState.mockReturnValue(createTwoBandState());
    });

    it('should schedule an engine write for an in-range band', () => {
        const deps = createDeps();
        const action = injectDependencies(setBacteriaBandParamWithAudio, deps);

        action(deviceId, 1, 'drive', 30);

        expect(setBacteriaBandParam).toHaveBeenCalledWith(deviceId, 1, 'drive', 30);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', deviceId, 'band1_drive', 30);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'band1_drive', 30);
    });

    it('should not schedule an engine write for an out-of-range band index', () => {
        // Regression: the store no-ops on an out-of-range index, but the bridge
        // previously still encoded and scheduled the engine write. The bounds
        // guard must short-circuit before any engine/persist call.
        const deps = createDeps();
        const action = injectDependencies(setBacteriaBandParamWithAudio, deps);

        action(deviceId, 5, 'drive', 30);

        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });

    it('should not schedule an engine write for a negative band index', () => {
        const deps = createDeps();
        const action = injectDependencies(setBacteriaBandParamWithAudio, deps);

        action(deviceId, -1, 'drive', 30);

        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });
});
