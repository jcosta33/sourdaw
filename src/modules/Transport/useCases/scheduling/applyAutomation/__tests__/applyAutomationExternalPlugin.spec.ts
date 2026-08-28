import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { getCompensationDelay, getCurrentTime, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';
import { externalPluginParameterStore } from '#/modules/PluginHost/stores';

import { applyAutomation } from '../applyAutomation';

/**
 * AC-003: an automation lane on an external plugin device rides the live apply
 * path — target resolution, acceptance, clamping and slew are all the real
 * implementations, and the assertion is made where Transport hands the write to
 * the audio engine.
 *
 * That hand-off is the module boundary: `updateDeviceParam` carries the
 * parameter id as the string a target id spells, and `TrackNode` turns that
 * string into the native `u32` the bridge writes (covered in
 * `TrackNode.spec.ts`, which drives the same `'7'`).
 */

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore = { value: { tracks: [] as unknown[] }, subscribe: vi.fn(() => () => {}) };
    return {
        ...mod,
        trackStore,
        resolveEligibleDeviceWriteTarget: (deviceId: string) => {
            const owner = trackStore.value.tracks.find((candidate) =>
                (candidate as { devices: { id: string }[] }).devices.some((device) => device.id === deviceId)
            );
            return owner
                ? { status: 'eligible', trackId: (owner as { id: string }).id, deviceId }
                : { status: 'missing' };
        },
    };
});
vi.mock('#/modules/Automation/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/stores')>()),
    automationStore: { value: { lanes: [] } },
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    getAutomationValueAtBeat: vi.fn(() => 0),
    isRecordingAutomation: vi.fn(() => false),
    resolveAutoMatchValue: vi.fn(({ automationValue }: { automationValue: number }) => ({
        value: automationValue,
        isReleaseStart: false,
    })),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    scheduleSendAutomation: vi.fn(),
    scheduleTrackGain: vi.fn(),
    scheduleTrackPan: vi.fn(),
    updateDeviceParam: vi.fn(),
    getCurrentTime: vi.fn(() => 5),
    getCompensationDelay: vi.fn(() => 0),
}));

const PLUGIN_INSTANCE_ID = 'inst-console';
const DEVICE_ID = 'device-plugin';
/** Deliberately not 0 and not the parameter's position in the list. */
const DRIVE_PARAMETER_ID = 7;

type MutableStore<TValue> = { value: TValue };

function seedPluginLane(laneParameterId: string): void {
    (trackStore as unknown as MutableStore<{ tracks: unknown[] }>).value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                automationMode: 'read',
                clips: [],
                midiFx: [],
                sends: [],
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Console',
                        type: 'external-plugin',
                        bypassed: false,
                        // Empty, as `addExternalDevice` creates it: the lane must
                        // resolve from the instance's declaration, not from a key
                        // somebody happened to write.
                        parameterValues: {},
                        externalPluginId: 'plugin-a',
                        externalInstanceId: PLUGIN_INSTANCE_ID,
                    },
                ],
            },
        ],
    };
    (automationStore as unknown as MutableStore<{ lanes: unknown[] }>).value = {
        lanes: [
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: laneParameterId,
                minValue: -12,
                maxValue: 24,
                points: [{ beat: 0, value: 0 }],
            },
        ],
    };
}

describe('applyAutomation on an external plugin device', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getCurrentTime).mockReturnValue(5);
        vi.mocked(getCompensationDelay).mockReturnValue(0);
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
        vi.mocked(resolveAutoMatchValue).mockImplementation(({ automationValue }: { automationValue: number }) => ({
            value: automationValue,
            isReleaseStart: false,
        }));
        externalPluginParameterStore.set({
            byInstanceId: {
                [PLUGIN_INSTANCE_ID]: {
                    engineAttached: true,
                    parameters: [
                        {
                            id: DRIVE_PARAMETER_ID,
                            name: 'Drive',
                            value: 0,
                            defaultValue: 0,
                            minValue: -12,
                            maxValue: 24,
                            unit: 'dB',
                            isAutomatable: true,
                        },
                    ],
                },
            },
        });
    });

    it('lands the lane value on the plugin parameter the target names', () => {
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`);
        // Two ticks: the per-parameter slew only dispatches once the smoothed
        // value has moved past SLEW_EPSILON.
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(18);

        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        const [trackId, deviceId, paramId, value] = vi.mocked(updateDeviceParam).mock.calls[0]!;
        expect(trackId).toBe('track-1');
        expect(deviceId).toBe(DEVICE_ID);
        // The plugin's own `u32` id, spelled as the target id carries it — not
        // the parameter's index in the published list.
        expect(paramId).toBe(String(DRIVE_PARAMETER_ID));
        // One slew step from 0 toward the lane's 18 dB target, delivered in the
        // plugin's own declared units — not renormalised into a fabricated 0..1.
        expect(value).toBeCloseTo(18 * 0.4, 10);
    });

    it('refuses a lane naming a parameter the instance never declared', () => {
        seedPluginLane(`${DEVICE_ID}:99`);
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(18);

        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('drives nothing for an instance that never attached to the native engine', () => {
        externalPluginParameterStore.update((state) => ({
            byInstanceId: {
                [PLUGIN_INSTANCE_ID]: {
                    engineAttached: false,
                    parameters: state?.byInstanceId[PLUGIN_INSTANCE_ID]?.parameters ?? [],
                },
            },
        }));
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`);
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(18);

        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
});
