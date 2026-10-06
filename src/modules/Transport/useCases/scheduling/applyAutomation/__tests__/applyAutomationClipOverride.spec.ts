import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';

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
const CLIP = { id: 'clip-verse', startBeat: 8, endBeat: 16 };

type SeedLane = {
    id: string;
    clipId?: string;
    /** The curve value the mocked lookup answers for this lane at any beat. */
    value: number;
};

function seedLanes(lanes: SeedLane[]): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                automationMode: 'read',
                clips: [CLIP],
                midiFx: [],
                devices: [DEVICE],
                sends: [],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: lanes.map((lane) => ({
            id: lane.id,
            trackId: 'track-1',
            clipId: lane.clipId,
            parameterId: 'eq-1:eq-low-gain',
            minValue: 0,
            points: [{ beat: 0, value: lane.value }],
        })),
    };
    vi.mocked(getAutomationValueAtBeat).mockImplementation(
        (laneId: unknown) => lanes.find((lane) => lane.id === laneId)?.value ?? 0
    );
}

function deviceWrites(): number[] {
    return vi.mocked(updateDeviceParam).mock.calls.map((call) => call[3]);
}

describe('applyAutomation clip-scoped lane override (#4736)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
        schedulerSession.discontinuityEpoch = 7;
    });

    it('lets the clip-scoped lane own the parameter while its clip plays, suppressing the track-level lane', () => {
        // The track lane's curve moves with the beat so the old behavior —
        // both lanes writing, whichever changed most recently winning — would
        // leak its values into the device writes. A flat clip lane isolates
        // the law: only its value may reach the device.
        seedLanes([
            { id: 'lane-track', value: 0.2 },
            { id: 'lane-clip', clipId: CLIP.id, value: 0.8 },
        ]);
        vi.mocked(getAutomationValueAtBeat).mockImplementation((laneId: unknown, beat: unknown) =>
            laneId === 'lane-track' ? 0.2 + ((beat as number) - 8) * 0.01 : 0.8
        );

        applyAutomation(9);
        applyAutomation(10);
        applyAutomation(11);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-1', 'eq-low-gain', 0.8);
        expect(deviceWrites().every((value) => value === 0.8)).toBe(true);
    });

    it('hands the parameter back to the track-level lane when the clip window closes', () => {
        seedLanes([
            { id: 'lane-track', value: 0.2 },
            { id: 'lane-clip', clipId: CLIP.id, value: 0.8 },
        ]);
        vi.mocked(getAutomationValueAtBeat).mockImplementation((laneId: unknown, beat: unknown) =>
            laneId === 'lane-track' ? 0.2 + (beat as number) * 0.01 : 0.8
        );

        applyAutomation(9);
        applyAutomation(15);
        vi.mocked(updateDeviceParam).mockClear();
        // First tick past the clip end: the track lane is back in scope, and
        // because the override dropped its slew state it re-enters — the
        // write lands on its exact curve value, not a glide from a stale
        // smoothed value.
        applyAutomation(17);

        expect(deviceWrites()).toEqual([0.37]);
    });

    it('breaks two overlapping clip-scoped lanes to the one latest in lane order', () => {
        seedLanes([
            { id: 'lane-clip-a', clipId: CLIP.id, value: 0.5 },
            { id: 'lane-clip-b', clipId: CLIP.id, value: 0.9 },
        ]);
        vi.mocked(getAutomationValueAtBeat).mockImplementation((laneId: unknown, beat: unknown) =>
            laneId === 'lane-clip-a' ? 0.5 + ((beat as number) - 8) * 0.01 : 0.9
        );

        applyAutomation(9);
        applyAutomation(10);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-1', 'eq-low-gain', 0.9);
        expect(deviceWrites().every((value) => value === 0.9)).toBe(true);
    });

    it('suppresses nothing when no clip-scoped lane covers the beat', () => {
        seedLanes([
            { id: 'lane-track', value: 0.2 },
            { id: 'lane-clip', clipId: CLIP.id, value: 0.8 },
        ]);
        vi.mocked(getAutomationValueAtBeat).mockImplementation((laneId: unknown, beat: unknown) =>
            laneId === 'lane-track' ? 0.2 + (beat as number) * 0.01 : 0.8
        );

        applyAutomation(2);
        applyAutomation(3);

        const writes = deviceWrites();
        expect(writes).toHaveLength(2);
        expect(writes.every((value) => value > 0.2 && value < 0.25)).toBe(true);
    });
});
