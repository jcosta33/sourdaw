import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    type DeviceWriteTargetResolution,
    type Track,
    type resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';

import { type BacteriaPatch } from '../../../models/BacteriaPatch';
import { setBacteriaParam } from '../../../stores/bacteriaStore';
import { type PersistDeviceParamFn, type UpdateDeviceParamFn } from '../helpers';
import { setBacteriaParamWithAudio } from '../setBacteriaParamWithAudio';

type ScheduledEntry = {
    deviceId: string;
    key: string;
    value: number;
};

type FlushParam = (compositeKey: string, entry: ScheduledEntry) => void;
type ScheduleParam = (compositeKey: string, entry: ScheduledEntry, flush: FlushParam) => void;
type SetBacteriaParamMock = (
    deviceId: string,
    key: keyof BacteriaPatch,
    value: BacteriaPatch[keyof BacteriaPatch]
) => void;

const mocks = vi.hoisted(() => ({
    setBacteriaParam: vi.fn<SetBacteriaParamMock>(),
    schedule: vi.fn<ScheduleParam>(),
    cancel: vi.fn<(key: string) => void>(),
    cancelAll: vi.fn<() => void>(),
}));

vi.mock('../../../stores/bacteriaStore', () => ({
    setBacteriaParam: mocks.setBacteriaParam,
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
    resolveEligibleDeviceWriteTarget: typeof resolveEligibleDeviceWriteTarget;
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

function createDeps(
    resolutions: readonly DeviceWriteTargetResolution[] = [
        { status: 'eligible', trackId: 'track-1', deviceId: 'device-1' },
    ]
): {
    deps: BridgeDeps;
    calls: string[];
} {
    const calls: string[] = [];
    let resolutionIndex = 0;
    return {
        deps: {
            getAllTracks: vi.fn(() => [createTrackWithDevice('device-1')]),
            updateDeviceParam: vi.fn<UpdateDeviceParamFn>((trackId, deviceId, key, value) => {
                calls.push(`update:${trackId}:${deviceId}:${key}:${value}`);
            }),
            persistDeviceParam: vi.fn<PersistDeviceParamFn>((deviceId, key, value) => {
                calls.push(`persist:${deviceId}:${key}:${value}`);
            }),
            resolveEligibleDeviceWriteTarget: vi.fn<BridgeDeps['resolveEligibleDeviceWriteTarget']>(() => {
                const resolution = resolutions[Math.min(resolutionIndex, resolutions.length - 1)];
                resolutionIndex += 1;
                return resolution ?? { status: 'missing' };
            }),
        },
        calls,
    };
}

function getScheduledWrite(): [string, ScheduledEntry, FlushParam] {
    const scheduledWrite = mocks.schedule.mock.calls[0];
    if (scheduledWrite === undefined) {
        throw new Error('Expected paramBatcher.schedule to be called');
    }
    return scheduledWrite;
}

describe('setBacteriaParamWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should write the store immediately and schedule the encoded audio mode value for the matching device', () => {
        const { deps, calls } = createDeps();
        const action = injectDependencies(setBacteriaParamWithAudio, deps);

        action('device-1', 'globalRouting', 'mid-side');

        expect(setBacteriaParam).toHaveBeenCalledWith('device-1', 'globalRouting', 'mid-side');
        expect(mocks.schedule).toHaveBeenCalledTimes(1);

        const [compositeKey, entry, flushParam] = getScheduledWrite();
        expect(compositeKey).toBe('device-1:globalRouting');
        expect(entry).toEqual({
            deviceId: 'device-1',
            key: 'globalRouting',
            value: 2,
        });
        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();

        flushParam(compositeKey, entry);

        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'globalRouting', 2);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith('device-1', 'globalRouting', 2);
        expect(calls).toEqual(['update:track-1:device-1:globalRouting:2', 'persist:device-1:globalRouting:2']);
    });

    it('should not schedule an audio write when encoding returns null', () => {
        const { deps } = createDeps();
        const action = injectDependencies(setBacteriaParamWithAudio, deps);

        action('device-1', 'name', 'Warm Texture');

        expect(setBacteriaParam).toHaveBeenCalledWith('device-1', 'name', 'Warm Texture');
        expect(mocks.schedule).not.toHaveBeenCalled();
        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });

    it('should not schedule an audio write when no device ref exists', () => {
        const { deps } = createDeps([{ status: 'missing' }]);
        const action = injectDependencies(setBacteriaParamWithAudio, deps);

        action('missing-device', 'mix', 0.75);

        expect(setBacteriaParam).not.toHaveBeenCalled();
        expect(mocks.schedule).not.toHaveBeenCalled();
        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });

    it('rechecks ownership at flush and drops work whose owner became ineligible', () => {
        const { deps } = createDeps([
            { status: 'eligible', trackId: 'track-1', deviceId: 'device-1' },
            { status: 'ineligible' },
        ]);
        const action = injectDependencies(setBacteriaParamWithAudio, deps);

        action('device-1', 'mix', 0.75);
        const [compositeKey, entry, flushParam] = getScheduledWrite();
        flushParam(compositeKey, entry);

        expect(deps.resolveEligibleDeviceWriteTarget).toHaveBeenCalledTimes(2);
        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });
});
