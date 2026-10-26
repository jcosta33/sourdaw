import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildOfflineModulatorPlans,
    computeModulatorValue,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { secondsBetweenBeats } from '#/modules/Transport/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineAutomationBinding, type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';

import { scheduleTrackAutomationFixture, SHIPPING_GRAIN_SLEW_TICK_SECONDS } from './scheduleTrackAutomationFixture';

/** The plan shape the builder produces, derived rather than re-declared. */
type OfflineModulatorParamPlan = ReturnType<typeof buildOfflineModulatorPlans>[number];

const FILTER_PARAM = 'filter-cutoff';

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
}

function makeFilterStrategy(param: ReturnType<typeof makeParam>) {
    return {
        resolveOfflineAutomation: (parameterId: string) => {
            if (parameterId !== FILTER_PARAM) {
                return null;
            }
            return {
                kind: 'audioParam' as const,
                targets: [{ audioParam: param as unknown as AudioParam, scale: 1, offset: 0 }],
            };
        },
    };
}

function makeLfoPlan(): OfflineModulatorParamPlan {
    // The live curve at a beat, times the amount times the declared range — the
    // delta `applyModulationToEngine` computes, handed to the scheduler as data.
    const modulator = {
        id: 'lfo-1',
        name: 'LFO',
        trackId: 'track-1',
        kind: 'lfo' as const,
        config: { kind: 'lfo' as const, waveform: 'sine' as const, rate: 4, sync: true, phase: 0, depth: 1 },
        mappings: [],
        enabled: true,
    };
    const range = { min: 20, max: 20_000 };
    return {
        targetTrackId: 'track-1',
        deviceId: 'dev-1',
        parameterId: FILTER_PARAM,
        deviceType: 'builtin-filter',
        baseValue: 1000,
        paramMin: range.min,
        paramMax: range.max,
        deltaAtBeat: (beat: number) => computeModulatorValue(modulator, beat) * 1 * (range.max - range.min),
    };
}

describe('offline render carries modulator movement a lane cannot', () => {
    beforeEach(() => {
        setModulationDependencies({
            updateDeviceParam: vi.fn(),
            getPluginParamRange: (deviceType: string, paramId: string) => {
                if (deviceType === 'builtin-filter' && paramId === FILTER_PARAM) {
                    return { min: 20, max: 20_000, defaultValue: 1000, automatable: true };
                }
                return null;
            },
            quantiseValue: ({ value }) => value,
        });
    });

    it('sweeps an LFO-mapped filter cutoff across scheduling blocks in the LFO direction', () => {
        const param = makeParam();
        scheduleTrackAutomationFixture({
            lanes: [],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [{ deviceId: 'dev-1', deviceType: 'builtin-filter', strategy: makeFilterStrategy(param) }],
            durationSeconds: 8,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 0,
            sampleRate: 44_100,
            compensationDelaySec: 0,
            modulatorPlans: [makeLfoPlan()],
        });

        // A flat render would anchor the persisted base once; the sweep marches.
        const writes = param.setValueAtTime.mock.calls as unknown as [number, number][];
        expect(writes.length).toBeGreaterThan(10);

        // Sine from phase 0: (sin+1)/2 rises to its peak a quarter period in, so
        // the combined value must move UP across the first blocks — the direction
        // live's sweep takes — and cover ground far beyond the 1000 base.
        const values = writes.map(([value]) => value);
        const first = values.slice(0, 20);
        for (let index = 1; index < first.length; index++) {
            expect(first[index]!).toBeGreaterThan(first[index - 1]!);
        }
        expect(values[0]).toBeCloseTo(1000 + 0.5 * (20_000 - 20), 6);
        expect(Math.max(...values)).toBeGreaterThan(15_000);
        expect(Math.max(...values)).toBeLessThanOrEqual(20_000);

        // Pin the modulation slew coefficient itself. The max and monotonic
        // assertions above hold for any alpha in (0, 1], so a detuned glide
        // would sail through them; this recomputes the shipped recurrence —
        // seed at the first target, then `previous + (target − previous) ×
        // 0.4` per tick at the shipping grain — from the same LFO plan and
        // requires the emitted ramp to land on it.
        const alpha = 0.4;
        const tickSeconds = SHIPPING_GRAIN_SLEW_TICK_SECONDS;
        let previous: number | null = null;
        for (let index = 0; index < 8; index++) {
            // makeSecondsToBeat at a flat 120 bpm: one beat every 0.5 s.
            const beat = index * tickSeconds * 2;
            const target = 1000 + makeLfoPlan().deltaAtBeat(beat);
            const expected: number = previous === null ? target : previous + (target - previous) * alpha;
            previous = expected;
            expect(values[index]).toBeCloseTo(expected, 4);
        }
    });

    it('anchors a step modulator at its first cell instead of the persisted base', () => {
        const param = makeParam();
        const modulator = {
            id: 'step-1',
            name: 'Step',
            trackId: 'track-1',
            kind: 'step' as const,
            config: { kind: 'step' as const, steps: [1, 0], rate: 2, smooth: 0 },
            mappings: [],
            enabled: true,
        };
        scheduleTrackAutomationFixture({
            lanes: [],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [{ deviceId: 'dev-1', deviceType: 'builtin-filter', strategy: makeFilterStrategy(param) }],
            durationSeconds: 4,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 0,
            sampleRate: 44_100,
            compensationDelaySec: 0,
            modulatorPlans: [
                {
                    targetTrackId: 'track-1',
                    deviceId: 'dev-1',
                    parameterId: FILTER_PARAM,
                    deviceType: 'builtin-filter',
                    baseValue: 1000,
                    paramMin: 20,
                    paramMax: 20_000,
                    deltaAtBeat: (beat: number) => computeModulatorValue(modulator, beat) * 1 * (20_000 - 20),
                },
            ],
        });

        const writes = param.setValueAtTime.mock.calls as unknown as [number, number][];
        const first = writes[0];
        // Step cell 0 = 1 → full-range delta on the base, clamped to the ceiling.
        expect(first![0]).toBe(20_000);
    });

    it('resolves plans only for mappings whose device and automatable parameter exist', () => {
        const plans = buildOfflineModulatorPlans({
            tracks: [
                {
                    id: 'track-1',
                    devices: [{ id: 'dev-1', type: 'builtin-filter', parameterValues: { [FILTER_PARAM]: 1000 } }],
                },
            ],
        });
        void plans;
        // The store-backed default carries no modulators in a bare harness.
        expect(plans).toEqual([]);
    });
});

describe('modulator project phase reaches every terminal binding', () => {
    const changes = [
        { id: 'ramp', beat: 0, tempo: 100, curve: 'linear' as const },
        { id: 'end', beat: 8, tempo: 200, curve: 'instant' as const },
    ];
    const tickSeconds = 4.8 * Math.log(175 / 150);
    const anchor = 4;
    const compensation = 0.125;
    const sampleRate = 48_000;
    // Independent analytic inverse for tempo(b) = 100 + 12.5*b.
    const projectSecondsToBeat = (seconds: number) => (150 * Math.exp(seconds / 4.8) - 100) / 12.5;
    const projectBeatToSeconds = (beat: number) => secondsBetweenBeats(changes, 0, beat, 120);

    for (const family of ['audioParam', 'segments', 'curveWrite'] as const) {
        for (const baseSource of ['persisted', 'track-lane', 'clip-lane'] as const) {
            it(`${family} uses anchored ramp phase over the ${baseSource} on the compensated write clock`, () => {
                const param = makeParam();
                let segments: readonly OfflineAutomationSegment[] = [];
                const ceiling = { gain: { value: 0 } } as GainNode;
                const clipper = { curve: null } as WaveShaperNode;
                const curveWrites: [number, number][] = [];
                let binding: OfflineAutomationBinding;
                if (family === 'audioParam') {
                    binding = {
                        kind: 'audioParam',
                        targets: [{ audioParam: param as unknown as AudioParam, scale: 1, offset: 0 }],
                    };
                } else if (family === 'segments') {
                    binding = {
                        kind: 'segments',
                        apply: (stream) => {
                            segments = stream;
                        },
                    };
                } else {
                    binding = { kind: 'curveWrite', targets: { ceiling, clipper } };
                }
                const laneBase = baseSource === 'persisted' ? 0 : 2;
                const lanes: Parameters<typeof scheduleTrackAutomationFixture>[0]['lanes'] = [];
                if (baseSource !== 'persisted') {
                    lanes.push({
                        id: 'base',
                        trackId: 'track-1',
                        parameterId: 'dev-1:filter-cutoff',
                        parameterName: 'Cutoff',
                        clipId: baseSource === 'clip-lane' ? 'clip' : undefined,
                        points: [{ beat: anchor, value: laneBase, curve: 'step', tension: 0 }],
                        enabled: true,
                        minValue: 0,
                        maxValue: 100,
                    });
                }
                const input = {
                    lanes,
                    trackId: 'track-1',
                    trackGainNode: { gain: makeParam() } as unknown as GainNode,
                    trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
                    deviceEntries: [
                        {
                            deviceId: 'dev-1',
                            deviceType: 'builtin-filter',
                            strategy: { resolveOfflineAutomation: () => binding },
                        },
                    ],
                    durationSeconds: tickSeconds * 1.5,
                    changes,
                    slewTickSeconds: tickSeconds,
                    regionStartBeat: anchor,
                    regionStartSeconds: projectBeatToSeconds(anchor),
                    projectBeatToSeconds,
                    projectSecondsToBeat,
                    sampleRate,
                    compensationDelaySec: compensation,
                    clipBoundsById: new Map([['clip', { startBeat: anchor, endBeat: 8 }]]),
                    scheduleFrame: (time: number | undefined, call: () => void) => {
                        call();
                        curveWrites.push([ceiling.gain.value, time ?? 0]);
                    },
                    modulatorPlans: [
                        {
                            targetTrackId: 'track-1',
                            deviceId: 'dev-1',
                            parameterId: FILTER_PARAM,
                            deviceType: 'builtin-filter',
                            baseValue: 0,
                            paramMin: 0,
                            paramMax: 100,
                            deltaAtBeat: (beat: number) => beat,
                        },
                    ],
                };
                scheduleTrackAutomationFixture(input);
                // Beat 4 at the origin, beat 6 after the analytically integrated span;
                // the second delivered target is slewed once from 4 to 6.
                const seed = laneBase + 4;
                const second = laneBase + 4.8;
                if (family === 'audioParam') {
                    expect(param.setValueAtTime).toHaveBeenCalledWith(seed, 0);
                    expect(param.setValueAtTime).toHaveBeenCalledWith(seed, compensation);
                    expect(param.setValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(second, 10);
                    expect(param.setValueAtTime.mock.calls.at(-1)?.[1]).toBeCloseTo(tickSeconds + compensation, 10);
                } else if (family === 'segments') {
                    expect(segments).toHaveLength(2);
                    expect(segments[0]?.startFrame).toBe(Math.round(compensation * sampleRate));
                    expect(segments[0]?.startValue).toBe(seed);
                    expect(segments[1]?.startValue).toBeCloseTo(second, 10);
                    expect(segments[1]?.startFrame).toBe(Math.round((tickSeconds + compensation) * sampleRate));
                } else {
                    expect(curveWrites).toHaveLength(2);
                    expect(curveWrites[0]?.[0]).toBeCloseTo(dbToGain(seed), 10);
                    expect(curveWrites[1]?.[0]).toBeCloseTo(dbToGain(second), 10);
                    expect(curveWrites[1]?.[1]).toBeCloseTo(tickSeconds + compensation, 10);
                    expect(clipper.curve).not.toBeNull();
                }
            });
        }
    }

    it('quantises delivered values while retaining the continuous modulation recurrence', () => {
        const param = makeParam();
        const input = {
            lanes: [],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [{ deviceId: 'dev-1', deviceType: 'builtin-filter', strategy: makeFilterStrategy(param) }],
            durationSeconds: 1.1,
            changes: [],
            slewTickSeconds: 0.5,
            projectSecondsToBeat: (seconds: number) => seconds * 2,
            deviceParameterLaw: {
                acceptsAutomation: () => true,
                clampValue: ({ value }: { value: number }) => value,
                quantiseValue: ({ value }: { value: number }) => Math.round(value),
            },
            modulatorPlans: [
                {
                    targetTrackId: 'track-1',
                    deviceId: 'dev-1',
                    parameterId: FILTER_PARAM,
                    deviceType: 'builtin-filter',
                    baseValue: 4,
                    paramMin: 0,
                    paramMax: 100,
                    deltaAtBeat: (beat: number) => beat,
                },
            ],
        };
        scheduleTrackAutomationFixture(input);
        // The skipped rounded 4 still advances the continuous slot, so the
        // next tick delivers 5 without re-sending the held 4.
        expect(param.setValueAtTime.mock.calls.map(([value]) => value)).toEqual([4, 5]);
    });

    it('refuses a resolved modulator without its inverse, while lane-only scheduling needs none', () => {
        const param = makeParam();
        const input = {
            lanes: [],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [{ deviceId: 'dev-1', deviceType: 'builtin-filter', strategy: makeFilterStrategy(param) }],
            durationSeconds: 1,
            changes: [],
            projectSecondsToBeat: undefined,
        };
        const laneOnly = {
            ...input,
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track-1',
                    parameterId: 'dev-1:filter-cutoff',
                    parameterName: 'Cutoff',
                    points: [{ beat: 0, value: 10, curve: 'step' as const, tension: 0 }],
                    enabled: true,
                    minValue: 0,
                    maxValue: 100,
                },
            ],
        };
        expect(() => scheduleTrackAutomationFixture(laneOnly)).not.toThrow();
        expect(param.setValueAtTime).toHaveBeenCalledWith(10, 0);
        param.setValueAtTime.mockClear();
        expect(() => scheduleTrackAutomationFixture({ ...input, modulatorPlans: [makeLfoPlan()] })).toThrow(
            'Offline seconds-to-beat projection is not configured'
        );
        expect(param.setValueAtTime).not.toHaveBeenCalled();
    });
});
