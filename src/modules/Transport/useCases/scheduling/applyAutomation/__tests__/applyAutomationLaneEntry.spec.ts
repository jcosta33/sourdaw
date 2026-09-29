import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { updateDeviceParam, updateMidiFxParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';

import { schedulerSession } from '../../../playheadScheduler/schedulerSession';
import { applyAutomation } from '../applyAutomation';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore: { value: typeof mod.trackStore.value; subscribe: typeof mod.trackStore.subscribe } = {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn<typeof mod.trackStore.subscribe>((_callback) => () => {}),
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
        // Passthrough, the real function's no-pending-release branch: only the
        // AutoMatch re-entry case below injects a release start.
        resolveAutoMatchValue: vi.fn(({ automationValue }: { automationValue: number }) => ({
            value: automationValue,
            isReleaseStart: false,
        })),
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

const DEVICE = { id: 'eq-1', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } };
const SECOND_CLIP = { id: 'clip-chorus', startBeat: 8, endBeat: 16 };

function seedFlatClipLane(value: number): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                automationMode: 'read',
                clips: [SECOND_CLIP],
                midiFx: [],
                devices: [DEVICE],
                sends: [],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-flat',
                trackId: 'track-1',
                clipId: SECOND_CLIP.id,
                parameterId: 'eq-1:eq-low-gain',
                minValue: 0,
                points: [{ beat: 0, value }],
            },
        ],
    };
}

function seedFlatTrackLane(value: number): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                automationMode: 'read',
                clips: [],
                midiFx: [],
                devices: [DEVICE],
                sends: [],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-flat',
                trackId: 'track-1',
                parameterId: 'eq-1:eq-low-gain',
                minValue: 0,
                points: [{ beat: 0, value }],
            },
        ],
    };
}

function deviceWrites(): number[] {
    return vi.mocked(updateDeviceParam).mock.calls.map((call) => call[3]);
}

describe('applyAutomation device-lane scope entry (#4741)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
        // Continuous play: the epoch never advances, so no discontinuity snap
        // can cover the write — the lane's own entry must produce it.
        schedulerSession.discontinuityEpoch = 7;
    });

    it('writes a flat clip lane once at its own value on the tick the playhead enters the clip', () => {
        seedFlatClipLane(0.8);

        applyAutomation(4);
        // Before the clip the lane is out of scope: nothing written.
        expect(updateDeviceParam).not.toHaveBeenCalled();

        // Entering the clip writes the held value, once.
        applyAutomation(8);
        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-1', 'eq-low-gain', 0.8);

        // The lane keeps holding: the change gate still suppresses repeats.
        applyAutomation(9);
        applyAutomation(10);
        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
    });

    it('writes a flat track lane on the first tick after load, without any discontinuity', () => {
        seedFlatTrackLane(0.55);
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.55);

        applyAutomation(0);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-1', 'eq-low-gain', 0.55);
    });

    it('writes a moving lane on its first tick instead of starving it, seeding the glide at the curve value', () => {
        seedFlatTrackLane(0.2);
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0.2).mockReturnValue(0.75);

        applyAutomation(0);
        // The entry tick writes the curve's own opening value; the glide to
        // later targets starts from it, exactly as the offline slew seeds at
        // the compiled stream's opening value.
        expect(deviceWrites()).toEqual([0.2]);

        applyAutomation(1);
        expect(deviceWrites()[1]).toBeCloseTo(0.2 + (0.75 - 0.2) * 0.4, 12);
    });
});

const FX = { id: 'arp-1', type: 'arpeggiator', parameterValues: { 'arp-rate': 0 } };
const FX_CLIP = { id: 'clip-fx', startBeat: 8, endBeat: 16 };

function seedFlatFxClipLane(value: number): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'midi',
                automationMode: 'read',
                clips: [FX_CLIP],
                midiFx: [FX],
                devices: [],
                sends: [],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-fx-flat',
                trackId: 'track-1',
                clipId: FX_CLIP.id,
                parameterId: 'arp-rate',
                minValue: 0,
                points: [{ beat: 0, value }],
            },
        ],
    };
}

function seedFlatFxTrackLane(value: number): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'midi',
                automationMode: 'read',
                clips: [],
                midiFx: [FX],
                devices: [],
                sends: [],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-fx-track',
                trackId: 'track-1',
                parameterId: 'arp-rate',
                minValue: 0,
                points: [{ beat: 0, value }],
            },
        ],
    };
}

function fxWrites(): number[] {
    return vi.mocked(updateMidiFxParam).mock.calls.map((call) => call[3]);
}

describe('applyAutomation midi-fx lane scope entry (#4911)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
        // Continuous play: the epoch never advances, so no discontinuity snap
        // can cover the write — the lane's own entry must produce it.
        schedulerSession.discontinuityEpoch = 7;
    });

    it('writes a flat clip lane once at its own value on the tick the playhead enters the fx clip', () => {
        seedFlatFxClipLane(0.8);
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.8);

        applyAutomation(4);
        // Before the clip the lane is out of scope: nothing written.
        expect(updateMidiFxParam).not.toHaveBeenCalled();

        // Entering the clip writes the held value, once.
        applyAutomation(8);
        expect(updateMidiFxParam).toHaveBeenCalledTimes(1);
        expect(updateMidiFxParam).toHaveBeenCalledWith('track-1', 'arp-1', 'arp-rate', 0.8);

        // The lane keeps holding: the change gate still suppresses repeats.
        applyAutomation(9);
        applyAutomation(10);
        expect(updateMidiFxParam).toHaveBeenCalledTimes(1);
    });

    it('writes a flat track lane on the first tick after load, without any discontinuity', () => {
        seedFlatFxTrackLane(0.55);
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.55);

        applyAutomation(0);

        expect(updateMidiFxParam).toHaveBeenCalledTimes(1);
        expect(updateMidiFxParam).toHaveBeenCalledWith('track-1', 'arp-1', 'arp-rate', 0.55);
    });

    it('writes a moving lane on its first tick at the curve value and slews exactly as before', () => {
        seedFlatFxTrackLane(0.2);
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0.2).mockReturnValue(0.75);

        applyAutomation(0);
        // The entry tick writes the curve's own opening value; the glide to
        // later targets starts from it. Moving lanes are unchanged by #4911.
        expect(fxWrites()).toEqual([0.2]);

        applyAutomation(1);
        expect(fxWrites()[1]).toBeCloseTo(0.2 + (0.75 - 0.2) * 0.4, 12);
    });

    it('snaps again on the tick after an AutoMatch release drops the lane slew', () => {
        seedFlatFxTrackLane(0.6);
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.6);

        applyAutomation(0);
        expect(updateMidiFxParam).toHaveBeenCalledTimes(1);

        // The release start drops the lane's slew, so the next tick re-enters
        // with no previous value and must snap again — the released value is
        // held at the curve's own value, so nothing but the dropped slew
        // explains a second write.
        vi.mocked(resolveAutoMatchValue).mockReturnValueOnce({ value: 0.6, isReleaseStart: true });
        applyAutomation(1);
        expect(updateMidiFxParam).toHaveBeenCalledTimes(2);
        expect(updateMidiFxParam).toHaveBeenLastCalledWith('track-1', 'arp-1', 'arp-rate', 0.6);

        // Held value: the change gate suppresses repeats again.
        applyAutomation(2);
        expect(updateMidiFxParam).toHaveBeenCalledTimes(2);
    });
});
