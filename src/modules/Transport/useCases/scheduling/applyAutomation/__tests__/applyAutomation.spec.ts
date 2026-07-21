import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
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
        resolveEligibleDeviceWriteTarget: (deviceId: string) => {
            const track = trackStore.value?.tracks.find((candidate) =>
                candidate.devices.some((device) => device.id === deviceId)
            );
            if (!track) {
                return { status: 'missing' };
            }
            const runtimeKind: unknown = Reflect.get(track, 'kind');
            if (runtimeKind === 'vca') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', trackId: track.id, deviceId };
        },
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

function seedDeviceLane(options: {
    deviceType: string;
    deviceId: string;
    bareParamId: string;
    laneParameterId: string;
    trackKind?: string;
}): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: options.trackKind ?? 'audio',
                automationMode: 'read',
                clips: [],
                midiFx: [],
                devices: [
                    {
                        id: options.deviceId,
                        type: options.deviceType,
                        parameterValues: { [options.bareParamId]: 0 },
                    },
                ],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-1',
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

    it('routes a prefixed Fermenter param lane through the mapped use-case with the bare param id', () => {
        // Regression: automation lanes carry `${device.type}:${paramId}`
        // (`fermenter:filterCutoff`), while `parameterValues` is keyed by the
        // bare id (`filterCutoff`). Before the fix the prefixed lookup was
        // undefined, so the device branch never fired and the param was a no-op.
        seedDeviceLane({
            deviceType: 'fermenter',
            deviceId: 'device-f1',
            bareParamId: 'filterCutoff',
            laneParameterId: 'fermenter:filterCutoff',
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
            deviceType: 'builtin-eq',
            deviceId: 'device-eq1',
            bareParamId: 'eq-low-gain',
            laneParameterId: 'builtin-eq:eq-low-gain',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-eq1', 'eq-low-gain', expect.any(Number));
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
    });

    it('does not send device automation for an ineligible runtime VCA owner', () => {
        seedDeviceLane({
            deviceType: 'builtin-eq',
            deviceId: 'forbidden-device',
            bareParamId: 'eq-low-gain',
            laneParameterId: 'builtin-eq:eq-low-gain',
            trackKind: 'vca',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
    });
});
