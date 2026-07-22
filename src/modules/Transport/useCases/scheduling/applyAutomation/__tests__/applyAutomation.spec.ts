import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { setTrackGain, setTrackPan, updateDeviceParam, updateMidiFxParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';
import { setFermenterMappedParam } from '#/modules/Fermenter/useCases';

import { applyAutomation } from '../applyAutomation';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore: { value: typeof mod.trackStore.value } = {
        value: { tracks: [], selectedTrackId: null },
    };
    return {
        ...mod,
        trackStore,
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string) => {
            const owners = trackStore.value?.tracks.filter((candidate) =>
                candidate.devices.some((device) => device.id === deviceId)
            );
            if (!owners || owners.length === 0) {
                return { status: 'missing' };
            }
            if (owners.length !== 1) {
                return { status: 'ineligible' };
            }
            const track = owners[0]!;
            const runtimeKind: unknown = Reflect.get(track, 'kind');
            if (runtimeKind === 'vca') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', trackId: track.id, deviceId };
        }),
    };
});
vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...mod,
        automationStore: { value: { lanes: [] } },
    };
});
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...mod,
        getAutomationValueAtBeat: vi.fn(() => 0.75),
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
    return {
        ...mod,
        setFermenterMappedParam: vi.fn(),
    };
});

type MutableTrackStore = { value: { tracks: unknown[] } };
type MutableAutomationStore = { value: { lanes: unknown[] } };

const mutableTrackStore = trackStore as unknown as MutableTrackStore;
const mutableAutomationStore = automationStore as unknown as MutableAutomationStore;

type SeedDevice = {
    id: string;
    type: string;
    parameterValues: Record<string, number>;
};

function seedDeviceLane(options: {
    devices: SeedDevice[];
    laneParameterId: string;
    trackKind?: string;
    laneId?: string;
    midiFx?: Array<{ id: string; parameterValues: Record<string, number> }>;
    extraTracks?: unknown[];
}): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: options.trackKind ?? 'audio',
                automationMode: 'read',
                clips: [],
                midiFx: options.midiFx ?? [],
                devices: options.devices,
            },
            ...(options.extraTracks ?? []),
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: options.laneId ?? 'lane-1',
                trackId: 'track-1',
                parameterId: options.laneParameterId,
                minValue: 0,
                points: [{ beat: 0, value: 0.75 }],
            },
        ],
    };
}

describe('applyAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Re-arm the mocked value-at-beat after clearAllMocks resets it.
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.75);
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
    });

    it('should export applyAutomation', () => {
        expect(applyAutomation).toBeDefined();
        expect(typeof applyAutomation).toBe('function');
    });

    it('routes a canonical Fermenter lane through the mapped use-case with the bare param id', () => {
        seedDeviceLane({
            devices: [{ id: 'device-f1', type: 'fermenter', parameterValues: { filterCutoff: 0 } }],
            laneParameterId: 'device-f1:filterCutoff',
            laneId: 'fermenter-canonical',
        });

        // The per-param exponential slew only dispatches once the smoothed value
        // moves past SLEW_EPSILON, so drive two ticks with a changing target.
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        // The Fermenter contract use-case receives the BARE camelCase id; it owns
        // the camelCase→snake_case (`filterCutoff`→`cutoff`) DSP mapping that the
        // UI bridge applies, so the param reaches the engine instead of hitting
        // Rust's silent no-op arm.
        expect(setFermenterMappedParam).toHaveBeenCalledTimes(1);
        expect(setFermenterMappedParam).toHaveBeenCalledWith(
            expect.objectContaining({ deviceId: 'device-f1', paramId: 'filterCutoff' })
        );
        // It must NOT forward the prefixed id straight to the raw engine call.
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('strips the device-type prefix before forwarding a non-Fermenter device param', () => {
        // The prefix mismatch is generic to all device-param automation, not just
        // Fermenter — a builtin EQ band lane must reach updateDeviceParam with the
        // bare param id, never the prefixed `builtin-eq:eq-low-gain`.
        seedDeviceLane({
            devices: [{ id: 'device-eq1', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
            laneParameterId: 'builtin-eq:eq-low-gain',
            laneId: 'eq-legacy-type',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-eq1', 'eq-low-gain', expect.any(Number));
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
    });

    it('targets only the requested device when two devices share a type and parameter', () => {
        seedDeviceLane({
            devices: [
                { id: 'eq-a', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } },
                { id: 'eq-b', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } },
            ],
            laneParameterId: 'eq-b:eq-low-gain',
            laneId: 'eq-canonical',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-b', 'eq-low-gain', expect.any(Number));
        expect(resolveEligibleDeviceWriteTarget).toHaveBeenCalledTimes(2);
    });

    it('accepts a bare legacy parameter only when exactly one eligible device exposes it', () => {
        seedDeviceLane({
            devices: [
                { id: 'eq-a', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } },
                { id: 'gain-a', type: 'builtin-gain', parameterValues: { 'gain-level': 0 } },
            ],
            laneParameterId: 'eq-low-gain',
            laneId: 'eq-legacy-bare',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-a', 'eq-low-gain', expect.any(Number));
    });

    it.each(['builtin-eq:eq-low-gain', 'eq-low-gain'])('rejects ambiguous legacy target %s', (laneParameterId) => {
        seedDeviceLane({
            devices: [
                { id: 'eq-a', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } },
                { id: 'eq-b', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } },
            ],
            laneParameterId,
            laneId: `ambiguous-${laneParameterId}`,
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not fall through a duplicate-owned bare device target to a same-named MIDI FX parameter', () => {
        const duplicate = { id: 'eq-a', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } };
        seedDeviceLane({
            devices: [duplicate],
            laneParameterId: 'eq-low-gain',
            laneId: 'duplicate-owner',
            midiFx: [{ id: 'midi-fx', parameterValues: { 'eq-low-gain': 0 } }],
            extraTracks: [
                {
                    id: 'track-2',
                    kind: 'audio',
                    automationMode: 'read',
                    clips: [],
                    midiFx: [],
                    devices: [duplicate],
                },
            ],
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(updateMidiFxParam).not.toHaveBeenCalled();
    });

    it.each(['missing:eq-low-gain', 'gain-a:eq-low-gain'])(
        'fails closed for canonical target %s instead of falling through',
        (laneParameterId) => {
            seedDeviceLane({
                devices: [
                    { id: 'eq-a', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } },
                    { id: 'gain-a', type: 'builtin-gain', parameterValues: { 'gain-level': 0 } },
                ],
                laneParameterId,
                laneId: `invalid-${laneParameterId}`,
            });

            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).not.toHaveBeenCalled();
        }
    );

    it('keeps track gain and pan lane behavior unchanged', () => {
        mutableTrackStore.value = {
            tracks: [{ id: 'track-1', kind: 'audio', automationMode: 'read', clips: [], midiFx: [], devices: [] }],
        };
        mutableAutomationStore.value = {
            lanes: [
                { id: 'gain-lane', trackId: 'track-1', parameterId: 'gain', minValue: 0, points: [{}] },
                { id: 'pan-lane', trackId: 'track-1', parameterId: 'pan', minValue: -1, points: [{}] },
            ],
        };

        applyAutomation(0);

        expect(setTrackGain).toHaveBeenCalledWith('track-1', 0.75);
        expect(setTrackPan).toHaveBeenCalledWith('track-1', 25);
    });

    it('does not send device automation for an ineligible runtime VCA owner', () => {
        seedDeviceLane({
            devices: [{ id: 'forbidden-device', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
            laneParameterId: 'builtin-eq:eq-low-gain',
            trackKind: 'vca',
            laneId: 'ineligible-device',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
    });
});
