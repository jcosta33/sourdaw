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

function seedPluginLane(laneParameterId: string, parameterValues: Record<string, number> = {}): void {
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
                        // Empty by default, as `addExternalDevice` creates it: the
                        // lane must resolve from the instance's declaration, not
                        // from a key somebody happened to write.
                        parameterValues,
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

    it('clamps a curve value below the declared range to the minimum the instance published', () => {
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`);
        // What a linked lane produces: `getAutomationValueAtBeat` applies
        // `linkScale` *after* clamping to the lane's range, so the value handed
        // to the apply path is not held by anything the lane declares.
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(-20_000);

        applyAutomation(0);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        // The instance declared -12; delivering the raw -20000 would hand the
        // plugin a setting it never said it accepts.
        expect(vi.mocked(updateDeviceParam).mock.calls[0]![3]).toBe(-12);
    });

    it('clamps a curve value above the declared range to the maximum the instance published', () => {
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`);
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(20_000);

        applyAutomation(0);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(vi.mocked(updateDeviceParam).mock.calls[0]![3]).toBe(24);
    });

    it('carries the clamped value into the slew state so the filter cannot wind up outside the range', () => {
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`);
        // Far below the range, then back inside it. The second tick glides from
        // whatever the first tick stored.
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(-20_000).mockReturnValue(0);

        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledTimes(2);
        // One α = 0.4 step from the clamped -12 toward 0. Had the filter kept
        // the unclamped -20000, this step would land at -12000 and clamp back to
        // -12 — the ride would sit pinned at the boundary for thousands of ticks
        // instead of leaving it on the next one.
        expect(vi.mocked(updateDeviceParam).mock.calls[1]![3]).toBeCloseTo(-7.2, 10);
    });

    it('leaves an external plugin parameter at the ride value on the driving edge: no base exists to restore', () => {
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`);
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(18);

        applyAutomation(0);
        applyAutomation(1);
        expect(updateDeviceParam).toHaveBeenCalled();

        vi.mocked(updateDeviceParam).mockClear();
        // Mutated in place: replacing the snapshot would be a project change,
        // which drops runtime ownership before the gate edge is ever reached.
        const track = (trackStore as unknown as MutableStore<{ tracks: { automationMode: string }[] }>).value
            .tracks[0]!;
        track.automationMode = 'off';

        applyAutomation(2);

        // A hosted plugin owns its own value: `parameterValues` stays empty, the
        // state chunk captured at save is the setting, and the store snapshot's
        // `value` is a menu-open reading that would jump the parameter to a
        // stale mid-ride figure. Nothing is written.
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('declines the restore even when the device carries a written parameterValues key', () => {
        // A hand write can persist a key on an external device, and no
        // descriptor answers for `external-plugin`, so the builtin acceptance
        // law would read that key as a manual base and step the plugin back to
        // it — undoing the ride with a value the plugin itself never reported.
        seedPluginLane(`${DEVICE_ID}:${DRIVE_PARAMETER_ID}`, { [String(DRIVE_PARAMETER_ID)]: 3 });
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(18);

        applyAutomation(0);
        applyAutomation(1);
        vi.mocked(updateDeviceParam).mockClear();

        const track = (trackStore as unknown as MutableStore<{ tracks: { automationMode: string }[] }>).value
            .tracks[0]!;
        track.automationMode = 'off';

        applyAutomation(2);

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
