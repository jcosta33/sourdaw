import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore, type AutomationLane as AutomationStoreLane } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases';

import { type AutomationLane as OfflineAutomationLane } from '../../../models/AutomationViewTypes';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * Pan clamp parity between live and offline for an overshooting smooth curve.
 *
 * The lane's declared range is the law live applies to every lane family:
 * `getAutomationValueAtBeat` bounds the interpolated value to it before any
 * branch sees the value. The offline pan branch applies the same bound through
 * the shared kernel (`#/utils/automationLaneBound`) at the same position (#2538)
 * — before the platform's own nominal-range clamp.
 *
 * That platform clamp used to be the branch's entire story: `StereoPannerNode.pan`
 * has a nominal range of [-1, 1] and the Web Audio specification clamps every
 * AudioParam write to it, which made the missing lane bound unobservable for a
 * lane declaring exactly [-1, 1] (the `addAutomationLane` default). It was
 * observable for any other declared range — a lane persisted with a narrower or
 * shifted range was released to the param's nominal range offline while the
 * monitor held it at its own. The declared range is the contract; offline now
 * matches live by construction rather than by the platform's coincidence, and
 * the nominal clamp remains a backstop neither side relies on.
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

function panOfflineLane(id: string, minValue: number, maxValue: number): OfflineAutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: 'pan',
        parameterName: 'Pan',
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

/** The value offline actually scheduled at `timeSeconds`, from whichever of
 *  the two AudioParam methods carried it. */
function offlineValueAt(pan: ReturnType<typeof makeParam>, timeSeconds: number): number {
    const calls = [...pan.setValueAtTime.mock.calls, ...pan.linearRampToValueAtTime.mock.calls] as [number, number][];
    const match = calls.find(([, time]) => Math.abs(time - timeSeconds) < 1e-9);
    expect(match, `no offline event scheduled at ${timeSeconds}s`).toBeDefined();
    return match![0];
}

function renderPanLane(lane: OfflineAutomationLane) {
    const pan = makeParam();
    scheduleTrackAutomationFixture({
        lanes: [lane],
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
    return pan;
}

describe('pan clamp parity between live and offline for an overshooting smooth curve', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('live and offline hold the crest at the lane’s declared range, matching value for value', () => {
        // Raw (unclamped) curve value: a lane whose declared range cannot bind
        // it, so getAutomationValueAtBeat returns the true interpolated value —
        // and offline, whose bound is the same law on the same range, must not
        // clamp it either.
        automationStore.set({ lanes: [panStoreLane('pan-raw', -1000, 1000)] });
        const rawLive = getAutomationValueAtBeat('pan-raw', OVERSHOOT_BEAT);
        expect(rawLive).not.toBeNull();
        const rawPan = renderPanLane(panOfflineLane('pan-raw', -1000, 1000));
        const rawOffline = offlineValueAt(rawPan, OVERSHOOT_TIME_SECONDS);
        expect(rawOffline).toBeCloseTo(rawLive!, 6);

        // The overshoot is real: the raw value exceeds the declared pan range
        // on its own, so the clamped assertions below are not vacuous.
        expect(rawOffline).toBeGreaterThan(1);

        // The real declared pan range (-1..1, addAutomationLane's default):
        // both sides clamp the crest to it — live explicitly in
        // getAutomationValueAtBeat, offline through the same shared bound.
        automationStore.set({ lanes: [panStoreLane('pan-1', -1, 1)] });
        const liveClamped = getAutomationValueAtBeat('pan-1', OVERSHOOT_BEAT);
        expect(liveClamped).toBe(1);

        const pan = renderPanLane(panOfflineLane('pan-1', -1, 1));
        expect(offlineValueAt(pan, OVERSHOOT_TIME_SECONDS)).toBe(liveClamped);
    });

    it('holds a pan lane to a declared range the platform clamp could not express', () => {
        // The case the platform clamp never covered: a lane persisted with a
        // declared ceiling below the param's nominal 1. Live holds the crest at
        // the declared 0.9; offline must hold the same line, where the nominal
        // [-1, 1] clamp would have printed the full crest.
        automationStore.set({ lanes: [panStoreLane('pan-narrow', -1, 0.9)] });
        const liveClamped = getAutomationValueAtBeat('pan-narrow', OVERSHOOT_BEAT);
        expect(liveClamped).toBe(0.9);

        const pan = renderPanLane(panOfflineLane('pan-narrow', -1, 0.9));
        expect(offlineValueAt(pan, OVERSHOOT_TIME_SECONDS)).toBe(liveClamped);
    });
});
