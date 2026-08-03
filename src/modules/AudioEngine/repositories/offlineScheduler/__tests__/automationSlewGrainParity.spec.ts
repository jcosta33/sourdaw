import { describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SLEW_ALPHA, automationSlewTickSecondsForGrain, slewStep } from '#/utils/automationSlew';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { type OfflineDeviceNode } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * AU-2 grain parity gate. Do not narrow this to a single grain.
 *
 * The live device-param slew runs exactly one `slewStep` per transport scheduler
 * tick, and `startPlayheadScheduler` ticks every `transportStore.scheduleGrainMs`
 * — a *settable* value. The offline replica used to sample the curve on a
 * hardcoded 10 ms grid, so it matched the monitor at the shipping default and
 * nowhere else: at any other grain the bounce's slew ran a different time
 * constant and automation ramps rendered differently from what was heard.
 *
 * A single-grain spec is exactly what hid that, because 10 ms is the one value
 * where the two definitions agree. So every case below drives a different grain
 * and asserts the emitted glide against the live recurrence run at *that* grain.
 */

const RAMP_END_SECONDS = 2;
const REGION_START_SECONDS = 64;
const DEFAULT_TEMPO = 120;
const DURATION_SECONDS = 4;

/**
 * Grains spanning the default in both directions: a fine grain a low-latency
 * session would set, the shipping default, and two coarse grains.
 */
const GRAINS_MS = [2.5, 10, 25, 50] as const;

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

/**
 * A single linear segment, beat 128 → 132 at 120 bpm with the export region
 * starting at beat 128. In render-relative seconds that is `x(t) = t / 2` over
 * `[0, 2]`, holding 1 afterwards — an exactly computable target curve, so the
 * expected glide is closed-form at any grain.
 */
function makeRampLane(): AutomationLane {
    return {
        id: 'lane-1',
        trackId: 'track-1',
        clipId: undefined,
        parameterId: 'device-1:gain-level',
        parameterName: 'Gain Level',
        points: [
            { beat: 128, value: 0, curve: 'linear', tension: 0 },
            { beat: 132, value: 1, curve: 'linear', tension: 0 },
        ],
        enabled: true,
        minValue: 0,
        maxValue: 1,
    };
}

function targetAt(timeSeconds: number): number {
    if (timeSeconds >= RAMP_END_SECONDS) {
        return 1;
    }
    return timeSeconds / RAMP_END_SECONDS;
}

/**
 * The live path, written out: one `slewStep` per scheduler tick against the
 * curve value at that tick, seeded on the curve (`prev ?? value`).
 */
function liveSlewSeries(tickSeconds: number, tickCount: number): { timeSeconds: number; value: number }[] {
    const series: { timeSeconds: number; value: number }[] = [];
    let smoothed = targetAt(0);
    for (let tick = 1; tick <= tickCount; tick++) {
        const timeSeconds = tick * tickSeconds;
        smoothed = slewStep(smoothed, targetAt(timeSeconds), AUTOMATION_SLEW_ALPHA);
        series.push({ timeSeconds, value: smoothed });
    }
    return series;
}

function renderDeviceLaneAtGrain(scheduleGrainMs: number) {
    const deviceParam = makeParam();
    const deviceNode: OfflineDeviceNode = {
        inputNode: {} as AudioNode,
        outputNode: {} as AudioNode,
        nodes: [{ gain: deviceParam } as unknown as AudioNode],
    };

    scheduleTrackAutomationFixture({
        lanes: [makeRampLane()],
        trackId: 'track-1',
        trackGainNode: { gain: makeParam() } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [
            {
                deviceId: 'device-1',
                deviceType: 'builtin-gain',
                strategy: new WebAudioDeviceStrategy(deviceNode, 'builtin-gain'),
            },
        ],
        durationSeconds: DURATION_SECONDS,
        defaultTempo: DEFAULT_TEMPO,
        changes: [],
        slewTickSeconds: automationSlewTickSecondsForGrain(scheduleGrainMs),
        regionStartSeconds: REGION_START_SECONDS,
    });

    return deviceParam.linearRampToValueAtTime.mock.calls.map((call) => ({
        value: call[0] as number,
        timeSeconds: call[1] as number,
    }));
}

describe('offline automation slew follows the live scheduler grain', () => {
    it.each(GRAINS_MS)('reproduces the live recurrence at scheduleGrainMs = %s', (scheduleGrainMs) => {
        const tickSeconds = automationSlewTickSecondsForGrain(scheduleGrainMs);
        const emitted = renderDeviceLaneAtGrain(scheduleGrainMs);
        // Stay strictly inside the ramp so the compared prefix is untouched by
        // the post-curve settle-and-hold tail.
        const tickCount = Math.floor(RAMP_END_SECONDS / tickSeconds) - 1;
        const expected = liveSlewSeries(tickSeconds, tickCount);

        expect(emitted.length).toBeGreaterThanOrEqual(tickCount);
        for (const [index, reference] of expected.entries()) {
            const actual = emitted[index]!;
            expect(actual.timeSeconds, `tick ${index + 1} time at ${scheduleGrainMs}ms grain`).toBeCloseTo(
                reference.timeSeconds,
                10
            );
            expect(actual.value, `tick ${index + 1} value at ${scheduleGrainMs}ms grain`).toBeCloseTo(
                reference.value,
                10
            );
        }
    });

    it('renders a different glide at each grain, so no single constant can satisfy them all', () => {
        // The regression this gate exists for: a hardcoded 10 ms tick renders one
        // curve for every grain setting. Read each render at the same wall-clock
        // instant — 50 ms in, a tick boundary at every grain here — and the four
        // values must all differ.
        const probeSeconds = 0.05;
        const valuesAtProbe = GRAINS_MS.map((scheduleGrainMs) => {
            const emitted = renderDeviceLaneAtGrain(scheduleGrainMs);
            const atProbe = emitted.find((event) => Math.abs(event.timeSeconds - probeSeconds) < 1e-9);
            expect(atProbe, `no event at ${probeSeconds}s for the ${scheduleGrainMs}ms grain`).toBeDefined();
            return atProbe!.value;
        });

        expect(new Set(valuesAtProbe).size).toBe(GRAINS_MS.length);
        // Coarsening the grain lowers the value at a fixed instant: fewer IIR
        // steps have run by the probe, and the extra reach of each step does not
        // make up for them. GRAINS_MS is ordered fine → coarse, so the readings
        // fall monotonically.
        for (let index = 1; index < valuesAtProbe.length; index++) {
            expect(valuesAtProbe[index]!).toBeLessThan(valuesAtProbe[index - 1]!);
        }
    });

    it('emits no slewed glide at all when the grain could not have driven a live tick', () => {
        // `automationSlewTickSecondsForGrain` reports 0 for a non-positive or
        // non-finite grain, and the compiler reads 0 as "do not slew" — the
        // honest answer, rather than silently substituting the default.
        const emitted = renderDeviceLaneAtGrain(0);

        expect(automationSlewTickSecondsForGrain(0)).toBe(0);
        // The raw compiled curve is a single linear segment: one ramp to the end
        // value, with none of the intermediate IIR samples a slew would insert.
        expect(emitted).toEqual([{ value: 1, timeSeconds: RAMP_END_SECONDS }]);
    });
});
