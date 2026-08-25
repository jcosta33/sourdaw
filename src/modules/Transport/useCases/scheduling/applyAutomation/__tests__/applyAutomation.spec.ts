import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deriveVcaMultiplier, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import {
    getCompensationDelay,
    getCurrentTime,
    scheduleSendAutomation,
    scheduleTrackGain,
    scheduleTrackPan,
    updateDeviceParam,
    updateMidiFxParam,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';
import { applyFermenterRuntimeParam, setFermenterMappedParam } from '#/modules/Fermenter/useCases';
import { AUTOMATION_SLEW_ALPHA, slewStep } from '#/utils/automationSlew';

import { applyAutomation } from '../applyAutomation';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore: { value: typeof mod.trackStore.value; subscribe: typeof mod.trackStore.subscribe } = {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn<typeof mod.trackStore.subscribe>((_callback) => () => {}),
    };
    return {
        ...mod,
        deriveVcaMultiplier: vi.fn(() => 1),
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
        scheduleSendAutomation: vi.fn(),
        scheduleTrackGain: vi.fn(),
        scheduleTrackPan: vi.fn(),
        getCurrentTime: vi.fn(() => 5),
        getCompensationDelay: vi.fn(() => 0),
        updateDeviceParam: vi.fn(),
        updateMidiFxParam: vi.fn(),
    };
});
vi.mock('#/modules/Fermenter/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Fermenter/useCases')>();
    return {
        ...mod,
        applyFermenterRuntimeParam: vi.fn(),
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

const EQ_A = { id: 'eq-a', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } };
const EQ_B = { id: 'eq-b', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } };
const GAIN_A = { id: 'gain-a', type: 'builtin-gain', parameterValues: { 'gain-level': 0 } };
const SPARSE_EQ_B = { ...EQ_B, parameterValues: {} };
type TargetCase = [string, string, SeedDevice[], string?];

function seedDeviceLane(options: {
    devices: SeedDevice[];
    laneParameterId: string;
    trackKind?: string;
    duplicateOwner?: boolean;
}): void {
    const track = {
        id: 'track-1',
        kind: options.trackKind ?? 'audio',
        automationMode: 'read',
        clips: [],
        midiFx: options.duplicateOwner ? [{ id: 'midi-fx', parameterValues: { 'eq-low-gain': 0 } }] : [],
        devices: options.devices,
        sends: [],
    };
    const tracks = options.duplicateOwner ? [track, { ...track, id: 'track-2', midiFx: [] }] : [track];
    mutableTrackStore.value = { tracks };
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
        vi.mocked(getCurrentTime).mockReturnValue(5);
        vi.mocked(getCompensationDelay).mockReturnValue(0);
        vi.mocked(deriveVcaMultiplier).mockReturnValue(1);
    });

    it('should export applyAutomation', () => {
        expect(applyAutomation).toBeDefined();
        expect(typeof applyAutomation).toBe('function');
    });

    it.each([
        [-1, -50],
        [0, 0],
        [1, 50],
    ])('maps canonical pan automation value %s to engine pan %s', (value, expectedPan) => {
        seedDeviceLane({ devices: [], laneParameterId: 'pan' });
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(value);

        applyAutomation(0);

        expect(scheduleTrackPan).toHaveBeenCalledWith('track-1', expectedPan, 5);
    });

    it('schedules a send lane on the compensated live clock without changing its tap', () => {
        seedDeviceLane({ devices: [], laneParameterId: 'send:bus-hall' });
        const track = mutableTrackStore.value.tracks[0] as {
            sends: Array<{ busId: string; level: number; preFader: boolean }>;
        };
        track.sends = [{ busId: 'bus-hall', level: 0.5, preFader: true }];
        vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.5 * 10 ** (-3 / 20));
        vi.mocked(getCompensationDelay).mockReturnValue(0.05);

        applyAutomation(16);

        expect(scheduleSendAutomation).toHaveBeenCalledWith('track-1', 'bus-hall', 0.5 * 10 ** (-3 / 20), 5.05);
        expect(scheduleTrackGain).not.toHaveBeenCalled();
        expect(scheduleTrackPan).not.toHaveBeenCalled();
    });

    it('routes a canonical Fermenter lane through the runtime-only mapped use-case', () => {
        seedDeviceLane({
            devices: [{ id: 'device-f1', type: 'fermenter', parameterValues: { filterCutoff: 0 } }],
            laneParameterId: 'device-f1:filterCutoff',
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
        expect(applyFermenterRuntimeParam).toHaveBeenCalledTimes(1);
        expect(applyFermenterRuntimeParam).toHaveBeenCalledWith(
            expect.objectContaining({ deviceId: 'device-f1', paramId: 'filterCutoff' })
        );
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
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
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-eq1', 'eq-low-gain', expect.any(Number));
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
    });

    it.each<TargetCase>([
        ['canonical duplicate type', 'eq-b:eq-low-gain', [EQ_A, EQ_B], 'eq-b'],
        ['unique bare', 'eq-low-gain', [EQ_A, GAIN_A], 'eq-a'],
        ['ambiguous type', 'builtin-eq:eq-low-gain', [EQ_A, EQ_B]],
        ['sparse duplicate type', 'builtin-eq:eq-low-gain', [EQ_A, SPARSE_EQ_B]],
        ['ambiguous bare', 'eq-low-gain', [EQ_A, EQ_B]],
        ['wrong canonical owner', 'gain-a:eq-low-gain', [EQ_A, GAIN_A]],
        ['track gain', 'gain', [], 'gain'],
        ['track pan', 'pan', [], 'pan'],
        ['duplicate owner MIDI collision', 'eq-low-gain', [EQ_A], 'midi'],
    ])('resolves %s target safely', (_name, laneParameterId, devices, expectedTarget) => {
        seedDeviceLane({ devices, laneParameterId, duplicateOwner: expectedTarget === 'midi' });
        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        if (expectedTarget === 'gain' || expectedTarget === 'pan') {
            const setter = expectedTarget === 'gain' ? scheduleTrackGain : scheduleTrackPan;
            expect(setter).toHaveBeenCalledWith('track-1', expectedTarget === 'gain' ? 0.75 : 37.5, 5);
            return;
        }
        if (expectedTarget && expectedTarget !== 'midi') {
            expect(vi.mocked(updateDeviceParam).mock.calls[0]?.[1]).toBe(expectedTarget);
            expect(resolveEligibleDeviceWriteTarget).toHaveBeenCalledTimes(2);
            return;
        }
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(updateMidiFxParam).not.toHaveBeenCalled();
    });

    it('does not send device automation for an ineligible runtime VCA owner', () => {
        seedDeviceLane({
            devices: [{ id: 'forbidden-device', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
            laneParameterId: 'builtin-eq:eq-low-gain',
            trackKind: 'vca',
        });

        vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        applyAutomation(0);
        applyAutomation(1);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
    });

    describe('RT-5 compensation-aligned, sample-accurate gain/pan scheduling', () => {
        it('schedules a gain lane at getCurrentTime() when the track carries no PDC (aligned to the musical position)', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            vi.mocked(getCurrentTime).mockReturnValue(12);
            vi.mocked(getCompensationDelay).mockReturnValue(0);

            applyAutomation(0);

            expect(scheduleTrackGain).toHaveBeenCalledWith('track-1', 0.75, 12);
        });

        it('delays the gain write by getCompensationDelay so it lands on the same clock as the compensated audio', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            vi.mocked(getCurrentTime).mockReturnValue(12);
            vi.mocked(getCompensationDelay).mockReturnValue(0.25);

            applyAutomation(0);

            // Before RT-5 this landed at getCurrentTime() (12), leading the
            // compensated audio by the track latency; it must now be shifted by
            // exactly the compensation delay.
            expect(scheduleTrackGain).toHaveBeenCalledWith('track-1', 0.75, 12.25);
            expect(scheduleTrackGain).not.toHaveBeenCalledWith('track-1', 0.75, 12);
        });

        it('shifts pan by the same compensation delay', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'pan' });
            vi.mocked(getCurrentTime).mockReturnValue(4);
            vi.mocked(getCompensationDelay).mockReturnValue(0.5);
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(1);

            applyAutomation(0);

            // canonical pan 1 → engine pan 50, landing at now + compensation.
            expect(scheduleTrackPan).toHaveBeenCalledWith('track-1', 50, 4.5);
        });

        it('reads getCompensationDelay once per track across gain and pan lanes in one tick', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            mutableAutomationStore.value.lanes.push({
                id: 'lane-2',
                trackId: 'track-1',
                parameterId: 'pan',
                minValue: 0,
                points: [{ beat: 0, value: 0.75 }],
            });

            applyAutomation(0);

            expect(getCompensationDelay).toHaveBeenCalledTimes(1);
            expect(getCompensationDelay).toHaveBeenCalledWith('track-1');
        });

        it('composes the VCA multiplier into the gain write so a member lane scales with its group instead of nullifying it', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            vi.mocked(getCurrentTime).mockReturnValue(2);
            vi.mocked(getCompensationDelay).mockReturnValue(0);
            vi.mocked(deriveVcaMultiplier).mockReturnValue(0.5);

            applyAutomation(0);

            // Composed 0.75 × 0.5 = 0.375, NOT the un-composed 0.75 the pre-fix path
            // wrote (whose VCA our cancelScheduledValues would then have erased).
            expect(scheduleTrackGain).toHaveBeenCalledWith('track-1', 0.375, 2);
            expect(scheduleTrackGain).not.toHaveBeenCalledWith('track-1', 0.75, 2);
        });

        it('returns the gain-owned track ids so applyVcaGains defers to the composed write', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });

            const owned = applyAutomation(0);

            expect(owned.has('track-1')).toBe(true);
        });

        it('does not claim gain ownership for a pan-only lane', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'pan' });

            const owned = applyAutomation(0);

            expect(owned.has('track-1')).toBe(false);
        });
    });

    describe('early-exit and lane-filtering branches', () => {
        it('returns an empty set and schedules nothing when automationStore.value is null', () => {
            mutableAutomationStore.value = null as unknown as { lanes: unknown[] };

            const owned = applyAutomation(0);

            expect(owned).toEqual(new Set());
            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a lane with no points', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableAutomationStore.value.lanes as Array<{ points: unknown[] }>)[0]!.points = [];

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a lane whose track is absent from the track index', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableAutomationStore.value.lanes as Array<{ trackId: string }>)[0]!.trackId = 'missing-track';

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a lane whose track has automationMode off', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableTrackStore.value.tracks as Array<{ automationMode: string }>)[0]!.automationMode = 'off';

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a clip-scoped lane when the clip is missing from the track', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableAutomationStore.value.lanes as Array<{ clipId?: string }>)[0]!.clipId = 'absent-clip';

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a clip-scoped lane when the current beat falls before the clip', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableTrackStore.value.tracks as Array<{ clips: unknown[] }>)[0]!.clips = [
                { id: 'clip-1', startBeat: 4, endBeat: 8 },
            ];
            (mutableAutomationStore.value.lanes as Array<{ clipId?: string }>)[0]!.clipId = 'clip-1';

            applyAutomation(0); // beat 0 < clip startBeat 4

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a clip-scoped lane when the current beat falls after the clip', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableTrackStore.value.tracks as Array<{ clips: unknown[] }>)[0]!.clips = [
                { id: 'clip-1', startBeat: 4, endBeat: 8 },
            ];
            (mutableAutomationStore.value.lanes as Array<{ clipId?: string }>)[0]!.clipId = 'clip-1';

            applyAutomation(10); // beat 10 > clip endBeat 8

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('applies a clip-scoped lane when the beat is within the clip range', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            (mutableTrackStore.value.tracks as Array<{ clips: unknown[] }>)[0]!.clips = [
                { id: 'clip-1', startBeat: 4, endBeat: 8 },
            ];
            (mutableAutomationStore.value.lanes as Array<{ clipId?: string }>)[0]!.clipId = 'clip-1';

            applyAutomation(6); // 4 <= 6 <= 8

            expect(scheduleTrackGain).toHaveBeenCalledWith('track-1', expect.any(Number), expect.any(Number));
        });

        it('skips a lane currently being recorded', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            vi.mocked(isRecordingAutomation).mockReturnValue(true);

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('skips a lane whose resolved value at the beat is null', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(null);

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });

        it('tolerates an absent trackStore.value (empty index, no scheduling)', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            mutableTrackStore.value = undefined as unknown as { tracks: unknown[] };

            applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
        });
    });

    describe('gain dB conversion', () => {
        it('converts a dB gain lane (minValue < 0) to linear via 10^(value/20)', () => {
            seedDeviceLane({ devices: [], laneParameterId: 'gain' });
            // minValue < 0 marks the lane as dB-domain.
            (mutableAutomationStore.value.lanes as Array<{ minValue: number }>)[0]!.minValue = -60;
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(-6); // ≈ 0.501
            vi.mocked(getCurrentTime).mockReturnValue(0);
            vi.mocked(getCompensationDelay).mockReturnValue(0);

            applyAutomation(0);

            expect(scheduleTrackGain).toHaveBeenCalledWith('track-1', 10 ** (-6 / 20), 0);
        });
    });

    describe('device-param edge branches', () => {
        it('skips a lane whose resolved parameter id is empty (bare ":" target)', () => {
            seedDeviceLane({
                devices: [{ id: 'device-eq1', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
                // "device-eq1:" → getDeviceAutomationParameterId returns null → continue.
                laneParameterId: 'device-eq1:',
            });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).not.toHaveBeenCalled();
        });

        it('skips when resolveDeviceAutomationTargetIndex returns UNRESOLVED (ambiguous duplicate type)', () => {
            // Two EQs that both accept the param, no owner prefix → ambiguous.
            seedDeviceLane({
                devices: [EQ_A, EQ_B],
                laneParameterId: 'eq-low-gain',
            });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).not.toHaveBeenCalled();
        });

        it('skips device-param dispatch for a track kind that does not accept device updates', () => {
            // A MIDI track kind whose eligibility rejects device updates, with a
            // parameter that does not resolve to any device and no matching midiFx.
            seedDeviceLane({
                devices: [],
                laneParameterId: 'eq-low-gain',
                trackKind: 'return',
            });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).not.toHaveBeenCalled();
            expect(updateMidiFxParam).not.toHaveBeenCalled();
        });
    });

    describe('MIDI-FX automation slew', () => {
        it('dispatches a midiFx param when the smoothed value crosses the epsilon threshold', () => {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'midi',
                        automationMode: 'read',
                        clips: [],
                        devices: [],
                        midiFx: [{ id: 'midi-fx-1', parameterValues: { 'fx-param': 0 } }],
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-fx',
                        trackId: 'track-1',
                        parameterId: 'fx-param',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.9 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.9);

            applyAutomation(0);
            applyAutomation(1);

            expect(updateMidiFxParam).toHaveBeenCalledWith('track-1', 'midi-fx-1', 'fx-param', expect.any(Number));
        });

        it('does not dispatch on a fresh lane when the target already equals the seeded previous (within epsilon)', () => {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'midi',
                        automationMode: 'read',
                        clips: [],
                        devices: [],
                        midiFx: [{ id: 'midi-fx-1', parameterValues: { 'fx-param': 0 } }],
                    },
                ],
            };
            // Distinct lane id so the module-level slew Map is fresh for this
            // test (the shared automationState.pluginParamSlew is not reset
            // between tests, only the mock call records are).
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-fx-steady',
                        trackId: 'track-1',
                        parameterId: 'fx-param',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.5 }],
                    },
                ],
            };
            // First tick: laneSlew is empty so prev = `?? value` = value, and
            // slewStep(value, value) === value → |smoothed - prev| == 0 <= epsilon,
            // so the dispatch branch is skipped (the device path's symmetric guard).
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.5);

            applyAutomation(0);

            expect(updateMidiFxParam).not.toHaveBeenCalled();
        });
    });

    describe('lane.enabled gating', () => {
        function seedGatingTrack(devices: SeedDevice[]): void {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'read',
                        clips: [],
                        midiFx: [],
                        devices,
                        gain: 0.5,
                        pan: 0,
                    },
                ],
            };
        }

        const GATE_EQ = { id: 'eq-gate', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } };

        it('does not drive a device param from a lane whose enabled flag is false', () => {
            seedGatingTrack([GATE_EQ]);
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-gate-disabled',
                        trackId: 'track-1',
                        parameterId: 'eq-gate:eq-low-gain',
                        enabled: false,
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).not.toHaveBeenCalled();
        });

        it('drives the same device param when the lane is enabled', () => {
            seedGatingTrack([GATE_EQ]);
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-gate-enabled',
                        trackId: 'track-1',
                        parameterId: 'eq-gate:eq-low-gain',
                        enabled: true,
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };
            // mockReset first: the disabled case above queues a mockReturnValueOnce
            // it never consumes (its lane is gated out before the lookup), and
            // clearAllMocks does not drain a once-queue — the leftover would make
            // both ticks read the same value and suppress the dispatch here.
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'eq-gate', 'eq-low-gain', expect.any(Number));
        });

        it('does not schedule fader gain, nor claim the track, for a disabled gain lane', () => {
            seedGatingTrack([]);
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-gate-gain',
                        trackId: 'track-1',
                        parameterId: 'gain',
                        enabled: false,
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };

            const owned = applyAutomation(0);

            expect(scheduleTrackGain).not.toHaveBeenCalled();
            expect(owned.has('track-1')).toBe(false);
        });
    });

    describe('restores the manual base when a lane stops driving', () => {
        type GateTrack = { automationMode: string };

        function seedRestorableDeviceLane(laneId: string): void {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'read',
                        clips: [],
                        midiFx: [],
                        devices: [{ id: 'eq-restore', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0.2 } }],
                        gain: 0.4,
                        pan: 12,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: laneId,
                        trackId: 'track-1',
                        parameterId: 'eq-restore:eq-low-gain',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(0.75);
        }

        function setAutomationMode(mode: string): void {
            (mutableTrackStore.value.tracks as GateTrack[])[0]!.automationMode = mode;
        }

        it('writes the device parameter back to its persisted value when the mode goes off', () => {
            seedRestorableDeviceLane('lane-restore-off');
            applyAutomation(0);
            applyAutomation(1);
            expect(updateDeviceParam).toHaveBeenCalledTimes(1);

            setAutomationMode('off');
            applyAutomation(2);

            // 0.2 is the device's own persisted parameterValues entry — the manual
            // value 'off' is supposed to play. Before this, the parameter simply
            // froze wherever the ride left it (~0.3 from the slew above).
            expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', 'eq-restore', 'eq-low-gain', 0.2);
        });

        it('restores once, not on every subsequent tick', () => {
            seedRestorableDeviceLane('lane-restore-once');
            applyAutomation(0);
            applyAutomation(1);

            setAutomationMode('off');
            applyAutomation(2);
            const afterRestore = vi.mocked(updateDeviceParam).mock.calls.length;
            applyAutomation(3);
            applyAutomation(4);

            expect(vi.mocked(updateDeviceParam).mock.calls.length).toBe(afterRestore);
        });

        it('restores the fader to the track gain, and releases the track to the VCA writer', () => {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'read',
                        clips: [],
                        midiFx: [],
                        devices: [],
                        gain: 0.4,
                        pan: 12,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-restore-gain',
                        trackId: 'track-1',
                        parameterId: 'gain',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.75);
            applyAutomation(0);

            setAutomationMode('off');
            const owned = applyAutomation(1);

            expect(scheduleTrackGain).toHaveBeenLastCalledWith('track-1', 0.4, 5);
            expect(owned.has('track-1')).toBe(false);
        });

        it('restores when the lane itself is disabled mid-ride and does not strand the parameter', () => {
            seedRestorableDeviceLane('lane-restore-disabled');
            applyAutomation(0);
            applyAutomation(1);

            (mutableAutomationStore.value.lanes as Array<{ enabled?: boolean }>)[0]!.enabled = false;
            applyAutomation(2);

            expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', 'eq-restore', 'eq-low-gain', 0.2);
        });

        it('restores a persisted send base when undo removes its driving lane', () => {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'read',
                        clips: [],
                        midiFx: [],
                        devices: [],
                        sends: [{ busId: 'bus-hall', level: 0.5, preFader: true }],
                        gain: 0.4,
                        pan: 12,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-removed-send-restore',
                        trackId: 'track-1',
                        parameterId: 'send:bus-hall',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.25 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.25);
            vi.mocked(getCompensationDelay).mockReturnValue(0.05);
            applyAutomation(16);
            expect(scheduleSendAutomation).toHaveBeenLastCalledWith('track-1', 'bus-hall', 0.25, 5.05);

            mutableAutomationStore.value = { lanes: [] };
            applyAutomation(16);

            expect(scheduleSendAutomation).toHaveBeenLastCalledWith('track-1', 'bus-hall', 0.5, 5.05);
        });
    });

    describe('AutoMatch release ramp', () => {
        it('writes the AutoMatch blend instead of the raw curve value while a release is gliding', () => {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'touch',
                        clips: [],
                        midiFx: [],
                        devices: [{ id: 'eq-am', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
                        gain: 0.4,
                        pan: 0,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-automatch',
                        trackId: 'track-1',
                        parameterId: 'eq-am:eq-low-gain',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.75);

            // Drive the lane normally first, so its slew holds a real pre-ride
            // value (~0.3) — the stale value a release must NOT glide from.
            vi.mocked(resolveAutoMatchValue).mockImplementation(({ automationValue }) => ({
                value: automationValue,
                isReleaseStart: false,
            }));
            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0);
            applyAutomation(0);
            applyAutomation(1);

            // Now release at 0.2 and glide back toward the curve's 0.75.
            vi.mocked(resolveAutoMatchValue).mockReturnValueOnce({ value: 0.2, isReleaseStart: true });
            applyAutomation(2);
            vi.mocked(resolveAutoMatchValue).mockReturnValueOnce({ value: 0.3375, isReleaseStart: false });
            applyAutomation(3);

            // The release tick re-seeds the slew at 0.2, so the next write is one
            // slew step from 0.2 toward the blend. Without the re-seed the slew
            // would still hold the stale pre-ride value and land elsewhere;
            // without the blend it would chase the curve's 0.75 outright.
            expect(updateDeviceParam).toHaveBeenLastCalledWith(
                'track-1',
                'eq-am',
                'eq-low-gain',
                slewStep(0.2, 0.3375, AUTOMATION_SLEW_ALPHA)
            );
        });

        it('passes the curve value and the engine clock to the AutoMatch resolver', () => {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'touch',
                        clips: [],
                        midiFx: [],
                        devices: [{ id: 'eq-am2', type: 'builtin-eq', parameterValues: { 'eq-low-gain': 0 } }],
                        gain: 0.4,
                        pan: 0,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: 'lane-automatch-args',
                        trackId: 'track-1',
                        parameterId: 'eq-am2:eq-low-gain',
                        minValue: 0,
                        points: [{ beat: 0, value: 0.75 }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValue(0.75);

            applyAutomation(0);

            expect(resolveAutoMatchValue).toHaveBeenCalledWith({
                trackId: 'track-1',
                parameterId: 'eq-am2:eq-low-gain',
                automationValue: 0.75,
                nowSeconds: 5,
            });
        });
    });

    describe("the parameter descriptor's declared contract", () => {
        // `dutch-oven` is used because it declares both halves of the contract
        // against real product data: `shimmer_pitch` is automatable: false, and
        // `mix` declares minValue 0 / maxValue 1.
        function seedDescriptorLane(options: {
            laneId: string;
            deviceId: string;
            paramId: string;
            curveValue: number;
            /**
             * The value the first tick reads. The per-param slew only dispatches
             * once the smoothed value has moved past SLEW_EPSILON, so the lane
             * has to be seeded at something other than where it lands.
             */
            primeValue?: number;
        }): void {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'audio',
                        automationMode: 'read',
                        clips: [],
                        midiFx: [],
                        devices: [
                            {
                                id: options.deviceId,
                                type: 'dutch-oven',
                                parameterValues: { [options.paramId]: 0.2 },
                            },
                        ],
                        gain: 0.5,
                        pan: 0,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: options.laneId,
                        trackId: 'track-1',
                        parameterId: `${options.deviceId}:${options.paramId}`,
                        minValue: 0,
                        points: [{ beat: 0, value: options.curveValue }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat)
                .mockReturnValueOnce(options.primeValue ?? 0)
                .mockReturnValue(options.curveValue);
        }

        it('refuses to drive a parameter the descriptor marks non-automatable', () => {
            seedDescriptorLane({
                laneId: 'lane-non-automatable',
                deviceId: 'ov-shimmer',
                paramId: 'shimmer_pitch',
                curveValue: 0.75,
            });

            applyAutomation(0);
            applyAutomation(1);

            // Key presence alone used to be the whole test, and the key is
            // present here — a stored lane, a preset or a project file puts it
            // there whether or not the picker would ever have offered it.
            expect(updateDeviceParam).not.toHaveBeenCalled();
        });

        it('drives an automatable parameter on the same device', () => {
            seedDescriptorLane({
                laneId: 'lane-automatable',
                deviceId: 'ov-mix',
                paramId: 'mix',
                curveValue: 0.75,
            });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'ov-mix', 'mix', expect.any(Number));
        });

        it('holds an out-of-range curve value to the declared maximum before it reaches the engine', () => {
            // Lane data is validated on load for finiteness and
            // `maxValue >= minValue` only, never against the descriptor, so a
            // stored curve can ask for 4.2 on a 0..1 control.
            seedDescriptorLane({
                laneId: 'lane-overshoot',
                deviceId: 'ov-clamp-high',
                paramId: 'mix',
                curveValue: 4.2,
            });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', 'ov-clamp-high', 'mix', 1);
        });

        it('holds an under-range curve value to the declared minimum', () => {
            seedDescriptorLane({
                laneId: 'lane-undershoot',
                deviceId: 'ov-clamp-low',
                paramId: 'mix',
                curveValue: -3,
                primeValue: 1,
            });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', 'ov-clamp-low', 'mix', 0);
        });

        // The MIDI-FX branch reaches its DSP through updateMidiFxParam, not the
        // device write surface, so it carries its own copy of the acceptance
        // predicate. No shipped MIDI FX type declares a descriptor yet, so
        // `dutch-oven` stands in for the day one does — the branch reads
        // `fx.type` generically, and these lock it to the same law rather than
        // to the absence of data.
        function seedMidiFxLane(options: { laneId: string; paramId: string; curveValue: number }): void {
            mutableTrackStore.value = {
                tracks: [
                    {
                        id: 'track-1',
                        kind: 'midi',
                        automationMode: 'read',
                        clips: [],
                        devices: [],
                        midiFx: [
                            {
                                id: 'fx-descriptor',
                                type: 'dutch-oven',
                                parameterValues: { [options.paramId]: 0.2 },
                            },
                        ],
                        gain: 0.5,
                        pan: 0,
                    },
                ],
            };
            mutableAutomationStore.value = {
                lanes: [
                    {
                        id: options.laneId,
                        trackId: 'track-1',
                        parameterId: options.paramId,
                        minValue: 0,
                        points: [{ beat: 0, value: options.curveValue }],
                    },
                ],
            };
            vi.mocked(getAutomationValueAtBeat).mockReset();
            vi.mocked(getAutomationValueAtBeat).mockReturnValueOnce(0).mockReturnValue(options.curveValue);
        }

        it('refuses to drive a non-automatable MIDI-FX parameter', () => {
            seedMidiFxLane({ laneId: 'lane-fx-non-automatable', paramId: 'shimmer_pitch', curveValue: 0.75 });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateMidiFxParam).not.toHaveBeenCalled();
        });

        it('holds an out-of-range MIDI-FX curve value to the declared maximum', () => {
            seedMidiFxLane({ laneId: 'lane-fx-overshoot', paramId: 'mix', curveValue: 4.2 });

            applyAutomation(0);
            applyAutomation(1);

            expect(updateMidiFxParam).toHaveBeenLastCalledWith('track-1', 'fx-descriptor', 'mix', 1);
        });
    });
});
