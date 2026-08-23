import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';

import { schedulerSession } from '../../../playheadScheduler/schedulerSession';
import { applyAutomation } from '../applyAutomation';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore: { value: typeof mod.trackStore.value; subscribe: () => () => undefined } = {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn(() => () => undefined),
    };
    return {
        ...mod,
        trackStore,
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string) => {
            const owners = trackStore.value?.tracks.filter((candidate) =>
                candidate.devices.some((device) => device.id === deviceId)
            );
            if (!owners || owners.length !== 1) {
                return { status: 'missing' };
            }
            const track = owners[0]!;
            return { status: 'eligible', trackId: track.id, deviceId };
        }),
    };
});
vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return { ...mod, automationStore: { value: { lanes: [] } } };
});
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...mod,
        getAutomationValueAtBeat: vi.fn(() => 0.8),
        isRecordingAutomation: vi.fn(() => false),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
        updateDeviceParam: vi.fn(),
        updateMidiFxParam: vi.fn(),
    };
});
vi.mock('#/modules/Fermenter/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Fermenter/useCases')>();
    return { ...mod, applyFermenterRuntimeParam: vi.fn() };
});

type MutableTrackStore = { value: { tracks: unknown[] } };
type MutableAutomationStore = { value: { lanes: unknown[] } };
const mutableTrackStore = trackStore as unknown as MutableTrackStore;
const mutableAutomationStore = automationStore as unknown as MutableAutomationStore;

function seedDeviceLane(deviceId: string, laneId: string): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                automationMode: 'read',
                clips: [],
                midiFx: [],
                devices: [{ id: deviceId, type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: laneId,
                trackId: 'track-1',
                parameterId: `${deviceId}:eq-low-gain`,
                minValue: 0,
                points: [{ beat: 0, value: 0.8 }],
            },
        ],
    };
}

describe('applyAutomation transport discontinuity (AU-4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
    });

    it('snaps a device param to the new target on a discontinuity instead of gliding from the stale slew value', () => {
        seedDeviceLane('eq-jump', 'lane-jump');
        schedulerSession.discontinuityEpoch = 100;

        // Establish a stale smoothed slew value at the pre-jump target (0.8).
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.8);
        applyAutomation(0);
        vi.mocked(updateDeviceParam).mockClear();

        // A transport jump (seek / loop-wrap / follow-action) advances the epoch,
        // and the target changes to 0.2. The first post-jump write must be the
        // exact new target — a jump is a jump — not 0.8 + (0.2 - 0.8) * 0.4 = 0.56.
        schedulerSession.discontinuityEpoch = 101;
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.2);
        applyAutomation(10);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-jump', 'eq-low-gain', 0.2);
    });

    it('still slews normally within continuous playback when the epoch does not advance', () => {
        seedDeviceLane('eq-glide', 'lane-glide');
        schedulerSession.discontinuityEpoch = 200;

        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.8);
        applyAutomation(0);
        vi.mocked(updateDeviceParam).mockClear();

        // No epoch advance: the exponential slew must still ease toward the new
        // target rather than snapping, so the first write is the glided value.
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.2);
        applyAutomation(10);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        const [, , , written] = vi.mocked(updateDeviceParam).mock.calls[0]!;
        expect(written).toBeCloseTo(0.56, 5);
    });
});
