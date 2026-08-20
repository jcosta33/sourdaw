import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore, type AutomationLane as AutomationStoreLane } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases';

import { type AutomationLane as OfflineAutomationLane } from '../../../models/AutomationViewTypes';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * Pan clamp parity — reviewer finding on #2313.
 *
 * `getAutomationValueAtBeat.ts` now clamps its return to the lane's declared
 * `minValue`/`maxValue`. `TrackNode.schedulePanAutomation` (`../../../engine/
 * TrackNode.ts`) additionally clamps to [-1, 1] on every live write, so live
 * pan is doubly guarded. `automationScheduling.ts`'s `pan` branch (this
 * directory, `lane.parameterId === 'pan'`) is the one branch in that file with
 * no `valueTransform` — it schedules the raw interpolated curve value straight
 * onto `trackPanNode.pan`, with no clamp of its own.
 *
 * A reviewer proposed this is a live-vs-offline divergence: an overshooting
 * smooth (Catmull-Rom) curve would clamp live and not offline. It does not
 * materialize — `StereoPannerNode.pan`'s nominal range is [-1, 1], and the Web
 * Audio specification clamps every `AudioParam` write to its nominal range
 * regardless of how the value was scheduled. This spec pins that: it reads the
 * raw value offline actually writes (proving it really does overshoot, so the
 * assertion isn't vacuous), then applies the same nominal-range clamp a real
 * `StereoPannerNode.pan` applies, and checks it against what live computes.
 *
 * Do NOT "fix" the apparent gap by adding a `valueTransform` to the offline pan
 * branch or by moving the clamp into `evaluateAutomationCurve` — neither
 * changes any observable output, and the shared curve kernel does not have the
 * lane's declared bounds in scope.
 */

const OVERSHOOT_BEAT = 3.2;
const DEFAULT_TEMPO = 120;
// beat 3.2 at 120bpm (seconds = beat * 60/tempo) = 1.6s — the sample compileAutomationEvents
// emits exactly at 60/100 of the way through the pre-sampled [2,4] beat segment.
const OVERSHOOT_TIME_SECONDS = 1.6;

/**
 * Same overshoot shape as getAutomationValueAtBeat.spec.ts's "clamps a
 * smooth-curve overshoot to the lane declared maxValue": a Catmull-Rom segment
 * through beat 2 (0.95) toward beat 4 (1.0), with neighbors at beat 0 (0.2) and
 * beat 6 (0.2), overshoots past 1 around beat ~3.2.
 */
function storePoints(): AutomationStoreLane['points'] {
    return [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 2, value: 0.95, curve: 'smooth', tension: 0 },
        { beat: 4, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 6, value: 0.2, curve: 'linear', tension: 0 },
    ];
}

function offlinePoints(): OfflineAutomationLane['points'] {
    return [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 2, value: 0.95, curve: 'smooth', tension: 0 },
        { beat: 4, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 6, value: 0.2, curve: 'linear', tension: 0 },
    ];
}

function panStoreLane(id: string, minValue: number, maxValue: number): AutomationStoreLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: 'pan',
        parameterName: 'Pan',
        points: storePoints(),
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue,
        maxValue,
    };
}

function panOfflineLane(id: string): OfflineAutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: 'pan',
        parameterName: 'Pan',
        points: offlinePoints(),
        enabled: true,
        // Offline never reads these for the pan branch (no valueTransform) —
        // set to the lane's real declared range anyway so the fixture matches
        // what a project actually persists for a pan lane.
        minValue: -1,
        maxValue: 1,
    };
}

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
}

/** The value offline actually scheduled at `timeSeconds`, from whichever of
 *  the two AudioParam methods carried it. */
function offlineValueAt(pan: ReturnType<typeof makeParam>, timeSeconds: number): number {
    const calls = [...pan.setValueAtTime.mock.calls, ...pan.linearRampToValueAtTime.mock.calls] as [number, number][];
    const match = calls.find(([, time]) => Math.abs(time - timeSeconds) < 1e-9);
    expect(match, `no offline event scheduled at ${timeSeconds}s`).toBeDefined();
    return match![0];
}

describe('pan clamp parity between live and offline for an overshooting smooth curve', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('live and offline agree, and neither exceeds the pan AudioParam nominal range', () => {
        // Raw (unclamped) curve value: a lane whose declared range cannot bind
        // it, so getAutomationValueAtBeat returns the true interpolated value —
        // the same evaluateAutomationCurve output the offline compiler reads.
        automationStore.set({ lanes: [panStoreLane('pan-raw', -1000, 1000)] });
        const rawLive = getAutomationValueAtBeat('pan-raw', OVERSHOOT_BEAT);
        expect(rawLive).not.toBeNull();

        // The real declared pan range (-1..1, addAutomationLane's default):
        // getAutomationValueAtBeat now clamps to it before returning.
        automationStore.set({ lanes: [panStoreLane('pan-1', -1, 1)] });
        const liveClamped = getAutomationValueAtBeat('pan-1', OVERSHOOT_BEAT);
        expect(liveClamped).not.toBeNull();

        // Offline: automationScheduling.ts's pan branch writes the raw curve
        // value straight onto trackPanNode.pan, with no valueTransform.
        const pan = makeParam();
        scheduleTrackAutomationFixture({
            lanes: [panOfflineLane('pan-1')],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan } as unknown as StereoPannerNode,
            deviceEntries: [],
            durationSeconds: 4,
            defaultTempo: DEFAULT_TEMPO,
            changes: [],
            regionStartSeconds: 0,
            sampleRate: 44_100,
            compensationDelaySec: 0,
        });
        const rawOffline = offlineValueAt(pan, OVERSHOOT_TIME_SECONDS);

        // Both sides read the curve through the same evaluateAutomationCurve
        // kernel, so the raw values agree — this is what makes the rest of the
        // assertion meaningful rather than coincidental.
        expect(rawOffline).toBeCloseTo(rawLive!, 6);

        // The overshoot is real: offline's unguarded write exceeds the nominal
        // range on its own, so the test is not vacuously passing because
        // nothing ever left [-1, 1].
        expect(rawOffline).toBeGreaterThan(1);

        // Live clamps explicitly, in getAutomationValueAtBeat, to the lane's
        // declared range.
        expect(liveClamped).toBe(1);

        // Offline relies on the platform instead: per the Web Audio
        // specification, StereoPannerNode.pan has a nominal range of [-1, 1]
        // and every AudioParam write is clamped to it. Applying that clamp to
        // the raw value offline actually scheduled reproduces exactly what
        // live computed explicitly.
        const offlineAfterNominalRangeClamp = Math.max(-1, Math.min(1, rawOffline));
        expect(offlineAfterNominalRangeClamp).toBe(liveClamped);

        expect(liveClamped).toBeLessThanOrEqual(1);
        expect(liveClamped).toBeGreaterThanOrEqual(-1);
        expect(offlineAfterNominalRangeClamp).toBeLessThanOrEqual(1);
        expect(offlineAfterNominalRangeClamp).toBeGreaterThanOrEqual(-1);
    });
});
