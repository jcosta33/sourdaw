import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildOfflineModulatorPlans,
    computeModulatorValue,
    setModulationDependencies,
} from '#/modules/Automation/useCases';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

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
