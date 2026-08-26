import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore, type AutomationLane as AutomationStoreLane } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases';

import { type AutomationLane } from '../../../models/AutomationViewTypes';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * #2538 regression: the offline scheduler bounds EVERY lane family's smooth
 * overshoot to the lane's declared range, not gain alone.
 *
 * The canonical Catmull-Rom crest — points 0.2 / 0.95(smooth) / 1.0 / 0.2 —
 * overshoots to ~1.0749 around beat 3.2, past a declared maximum of 1. Live
 * clamps it inside `getAutomationValueAtBeat` on every lane family; before the
 * shared bound, offline applied that clamp on the gain branch only, so:
 *  - pan scheduled the raw overshoot onto `StereoPannerNode.pan`,
 *  - a send lane declaring a range other than [0, 1] was released to the
 *    branch's hardcoded [0, 1] clamp instead of its own declared range, and
 *  - a device lane met only the device parameter's own law, which is a
 *    different (usually wider) range than the lane's.
 * Each test below pins live-vs-offline parity at the crest, and each failed on
 * pre-fix code (verified by temporarily reverting the scheduler's bound
 * routing).
 */

const OVERSHOOT_BEAT = 3.2;
const DEFAULT_TEMPO = 120;
// beat 3.2 at 120bpm = 1.6s — a sample the compiler emits exactly.
const OVERSHOOT_TIME_SECONDS = 1.6;
const DECLARED_MAX = 1;

function storePoints(): AutomationStoreLane['points'] {
    return [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 2, value: 0.95, curve: 'smooth', tension: 0 },
        { beat: 4, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 6, value: 0.2, curve: 'linear', tension: 0 },
    ];
}

function offlinePoints(): AutomationLane['points'] {
    return [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 2, value: 0.95, curve: 'smooth', tension: 0 },
        { beat: 4, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 6, value: 0.2, curve: 'linear', tension: 0 },
    ];
}

function storeLane(id: string, parameterId: string, minValue: number, maxValue: number): AutomationStoreLane {
    return {
        id,
        trackId: 'track-1',
        parameterId,
        parameterName: 'Param',
        points: storePoints(),
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue,
        maxValue,
    };
}

function offlineLane(id: string, parameterId: string, minValue: number, maxValue: number): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId,
        parameterName: 'Param',
        points: offlinePoints(),
        enabled: true,
        minValue,
        maxValue,
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

/** The value offline scheduled at `timeSeconds`, from whichever param method carried it. */
function offlineValueAt(param: ReturnType<typeof makeParam>, timeSeconds: number): number {
    const calls = [...param.setValueAtTime.mock.calls, ...param.linearRampToValueAtTime.mock.calls] as [
        number,
        number,
    ][];
    const match = calls.find(([, time]) => Math.abs(time - timeSeconds) < 1e-9);
    expect(match, `no offline event scheduled at ${timeSeconds}s`).toBeDefined();
    return match![0];
}

describe('offline lane overshoot bound parity — pan, send and device lanes (#2538)', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('a pan lane exports the crest clamped to its declared range, matching the monitor', () => {
        // Live: getAutomationValueAtBeat holds the ~1.0749 crest at the lane's
        // declared 1 before `value * 50` ever runs.
        automationStore.set({ lanes: [storeLane('pan-live', 'pan', -1, 1)] });
        const live = getAutomationValueAtBeat('pan-live', OVERSHOOT_BEAT);
        expect(live).toBe(DECLARED_MAX);

        const pan = makeParam();
        scheduleTrackAutomationFixture({
            lanes: [offlineLane('pan-live', 'pan', -1, 1)],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan } as unknown as StereoPannerNode,
            deviceEntries: [],
            durationSeconds: 4,
            defaultTempo: DEFAULT_TEMPO,
            changes: [],
        });

        // Not vacuous: the raw crest really does exceed the declared range —
        // proven on the same geometry by a lane whose declared range admits it.
        const widePan = makeParam();
        scheduleTrackAutomationFixture({
            lanes: [offlineLane('pan-wide', 'pan', -2, 2)],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: widePan } as unknown as StereoPannerNode,
            deviceEntries: [],
            durationSeconds: 4,
            defaultTempo: DEFAULT_TEMPO,
            changes: [],
        });
        expect(offlineValueAt(widePan, OVERSHOOT_TIME_SECONDS)).toBeGreaterThan(DECLARED_MAX);

        expect(offlineValueAt(pan, OVERSHOOT_TIME_SECONDS)).toBe(DECLARED_MAX);
    });

    it('a send lane is bounded by its declared range, not by the branch’s hardcoded [0, 1]', () => {
        // A send lane declaring [0, 0.9]: the declared ceiling — 0.9 — is the
        // law. The branch's own [0, 1] clamp (the send pot's law, TrackNode's
        // live write clamp) is wider, so before the declared-range bound this
        // lane's crest printed at ~1.0 while the monitor held it at 0.9.
        const declaredMax = 0.9;
        // The premise of the case: the declared ceiling sits strictly inside the
        // branch's hardcoded clamp, so the two laws observably disagree.
        expect(declaredMax).toBeLessThan(DECLARED_MAX);
        automationStore.set({ lanes: [storeLane('send-live', 'send:bus-hall', 0, declaredMax)] });
        const live = getAutomationValueAtBeat('send-live', OVERSHOOT_BEAT);
        expect(live).toBe(declaredMax);

        const send = makeParam();
        scheduleTrackAutomationFixture({
            lanes: [offlineLane('send-live', 'send:bus-hall', 0, declaredMax)],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            sendAutomationParams: new Map([['send:bus-hall', send as unknown as AudioParam]]),
            deviceEntries: [],
            durationSeconds: 4,
            defaultTempo: DEFAULT_TEMPO,
            changes: [],
        });

        // The hardcoded clamp would have printed 1.0 here (it clamps the raw
        // ~1.0749 to [0, 1]'s ceiling); the declared range holds it at 0.9.
        expect(offlineValueAt(send, OVERSHOOT_TIME_SECONDS)).toBe(declaredMax);
    });

    it('a device lane is bounded by its declared range before the device parameter’s own law', () => {
        // The lane declares [0, 1]; the device parameter's law (injected below)
        // declares [0, 3] — a genuinely wider range, like a stereo widener's
        // 0..3 width. Live bounds the curve at the LANE's 1 first (inside
        // getAutomationValueAtBeat) and only then slews into the device law, so
        // the monitor never delivers a value past 1. Offline used to meet only
        // the device law, so this lane's crest rendered at ~1.0749.
        const deviceLaw = {
            acceptsAutomation: () => true,
            clampValue: ({ value }: { deviceType: string; paramId: string; value: number }) =>
                Math.min(3, Math.max(0, value)),
            quantiseValue: ({ value }: { deviceType: string; paramId: string; value: number }) => value,
        };
        const deviceParam = makeParam();
        const deviceEntries = [
            {
                deviceId: 'device-1',
                deviceType: 'builtin-stereo-widener',
                strategy: {
                    resolveOfflineAutomation: (name: string) =>
                        name === 'width-amount'
                            ? {
                                  kind: 'audioParam',
                                  targets: [{ audioParam: deviceParam as unknown as AudioParam, scale: 1, offset: 0 }],
                              }
                            : null,
                },
            },
        ];

        automationStore.set({ lanes: [storeLane('device-live', 'device-1:width-amount', 0, DECLARED_MAX)] });
        const live = getAutomationValueAtBeat('device-live', OVERSHOOT_BEAT);
        expect(live).toBe(DECLARED_MAX);

        scheduleTrackAutomationFixture({
            lanes: [offlineLane('device-live', 'device-1:width-amount', 0, DECLARED_MAX)],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries,
            durationSeconds: 4,
            defaultTempo: DEFAULT_TEMPO,
            changes: [],
            deviceParameterLaw: deviceLaw,
        });

        const emitted = [
            ...deviceParam.setValueAtTime.mock.calls,
            ...deviceParam.linearRampToValueAtTime.mock.calls,
        ].map(([value]) => value as number);
        expect(emitted.length).toBeGreaterThan(0);
        // The bound runs before the slew's device-law clamp, so nothing the
        // recurrence feeds itself — and nothing it emits — passes the lane's
        // declared 1. Pre-fix the glide chased the raw crest (~1.0749) and
        // emitted above 1; the device law's [0, 3] admitted all of it.
        const peak = Math.max(...emitted);
        expect(peak).toBeLessThanOrEqual(DECLARED_MAX);
        // Non-vacuous: the glide really rides into the ceiling's
        // neighbourhood — a bound that flattened the lane well under its
        // declared range would pass the check above.
        expect(peak).toBeGreaterThan(0.99);
    });
});
