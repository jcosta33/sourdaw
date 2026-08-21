import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { getAutomationLaneCeiling, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { scheduleTrackAutomationFixture } from '../../../repositories/offlineScheduler/__tests__/scheduleTrackAutomationFixture';

const LANE_ID = 'gain-lane';
const TRACK_ID = 'track-1';
const TEMPO = 120;
/** Beat 6 at 120 BPM. The lane's last point, so the whole ride is compiled. */
const DURATION_SECONDS = 3;
/** `AUTOMATION_SAMPLE_INTERVAL_SEC` (10 ms) expressed in beats at {@link TEMPO}. */
const LIVE_SWEEP_BEAT_STEP = 0.02;

/**
 * A smooth volume ride that crests just under unity, authored before the fader
 * gained its `+6 dB` of headroom — so the lane stores the legacy `maxValue: 1`
 * and every one of its points sits at or below unity.
 *
 * Catmull-Rom overshoots between control points by construction: the raw spline
 * through these four points reaches roughly `1.0748` around beat 3.2. Nothing on
 * this lane asks for headroom, so neither runtime may give it any.
 */
const LEGACY_RIDE_POINTS = [
    { beat: 0, value: 0.2, curve: 'linear' as const, tension: 0 },
    { beat: 2, value: 0.95, curve: 'smooth' as const, tension: 0 },
    { beat: 4, value: 1.0, curve: 'linear' as const, tension: 0 },
    { beat: 6, value: 0.2, curve: 'linear' as const, tension: 0 },
];

/**
 * The same legacy gain lane after a musician drew into the headroom — but only
 * at the top of the ride. The peak at beat 0 sits inside the `+6 dB` the fader
 * now reaches; the plateau across `[2, 4]` is bracketed by two points at `0.97`,
 * both under the `1` the lane still declares.
 *
 * That split is the whole point. The raise a legacy lane gets is the segment's,
 * not the lane's: the plateau asks for no headroom, so neither runtime may give
 * it any, even though a different segment of the same lane does.
 */
const SPLIT_HEADROOM_POINTS = [
    { beat: 0, value: 1.995, curve: 'smooth' as const, tension: 0 },
    { beat: 2, value: 0.97, curve: 'smooth' as const, tension: 0 },
    { beat: 4, value: 0.97, curve: 'linear' as const, tension: 0 },
    { beat: 6, value: 0.0, curve: 'linear' as const, tension: 0 },
];

/**
 * A beat inside the plateau segment, on the overshooting shoulder of its
 * Catmull-Rom curve, and on the offline compiler's 10 ms sample grid (beat 3.58
 * is 1.79 s at {@link TEMPO}, an exact multiple of the interval from the
 * segment start at 1 s) so the two runtimes can be compared at one instant
 * rather than through interpolation.
 *
 * Catmull-Rom takes its tangents from the surrounding points, so the peak at
 * beat 0 bends this segment above its own endpoints: the raw curve here is
 * ~1.01571, measured against the unmodified evaluator.
 */
const PLATEAU_OVERSHOOT_BEAT = 3.58;
const PLATEAU_OVERSHOOT_SECONDS = 1.79;

function makeLane(overrides: Partial<AutomationLane> = {}): AutomationLane {
    return {
        id: LANE_ID,
        trackId: TRACK_ID,
        clipId: undefined,
        parameterId: 'gain',
        parameterName: 'Volume',
        points: LEGACY_RIDE_POINTS.map((point) => ({ ...point })),
        enabled: true,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

/**
 * Put the same lane into the store the monitor reads from.
 *
 * Automation's own lane model carries view state the offline scheduler has no
 * opinion about; the fields both runtimes read are the ones spread in here, so
 * the two halves of this spec really are reading one lane.
 */
function seedLiveLane(lane: AutomationLane): void {
    automationStore.set({
        lanes: [{ ...lane, objects: [], visible: true, collapsed: false }],
    });
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

/**
 * Every gain value the offline render would write, in schedule order.
 *
 * `resolveLaneCeiling` is the production law, not a fixture stand-in — the
 * defect this spec pins is that the widened ceiling reaches the offline path at
 * all, so substituting a narrower one here would prove nothing.
 */
function offlineGainWrites(lane: AutomationLane): { timeSeconds: number; value: number }[] {
    const gain = makeParam();
    scheduleTrackAutomationFixture({
        lanes: [lane],
        trackId: TRACK_ID,
        trackGainNode: { gain } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries: [],
        durationSeconds: DURATION_SECONDS,
        defaultTempo: TEMPO,
        changes: [],
        resolveLaneCeiling: getAutomationLaneCeiling,
    });
    return [...gain.setValueAtTime.mock.calls, ...gain.linearRampToValueAtTime.mock.calls].map(
        ([value, timeSeconds]) => ({ value: value as number, timeSeconds: timeSeconds as number })
    );
}

function offlineGainValues(lane: AutomationLane): number[] {
    return offlineGainWrites(lane).map((write) => write.value);
}

/**
 * The single gain value the offline render writes at `seconds`.
 *
 * Asserted to exist rather than defaulted, because a beat that fell off the
 * sample grid would otherwise turn this spec into a comparison against nothing.
 */
function offlineGainValueAt(lane: AutomationLane, seconds: number): number {
    const matches = offlineGainWrites(lane).filter((write) => Math.abs(write.timeSeconds - seconds) < 1e-9);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
        expect(match.value).toBe(matches[0]!.value);
    }
    return matches[0]!.value;
}

/** Every gain value the monitor would play, swept on the offline sample grid. */
function liveGainValues(): number[] {
    const values: number[] = [];
    for (let beat = 0; beat <= 6; beat += LIVE_SWEEP_BEAT_STEP) {
        const value = getAutomationValueAtBeat(LANE_ID, beat);
        if (value !== null) {
            values.push(value);
        }
    }
    return values;
}

describe('offline render bounds a legacy gain lane the way the monitor does', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
        vi.clearAllMocks();
    });

    /**
     * Both halves on one lane, because a suite that only ever asks the monitor
     * reads as a parity claim nobody tested.
     *
     * Before the fader widened these two ceilings agreed by accident:
     * `FADER_MAX_GAIN` was `1` and a legacy gain lane declares `1`, so the
     * offline path's fader clamp happened to land on the lane bound. They are
     * now `1` and about `1.9953`, and without the lane bound the bounce prints
     * the spline overshoot the monitor clamped away — a project opened,
     * unedited and exported comes back louder than it plays.
     */
    it('bounces a legacy smooth gain ride no louder than the monitor plays it', () => {
        const lane = makeLane();
        seedLiveLane(lane);

        const live = liveGainValues();
        const offline = offlineGainValues(lane);

        expect(offline.length).toBeGreaterThan(0);
        // The ride reaches its declared top on both sides, so neither number
        // below is the max of a stream that quietly rendered nothing.
        expect(Math.max(...live)).toBe(1);
        expect(Math.max(...offline)).toBe(1);
        expect(Math.max(...offline)).toBeLessThanOrEqual(Math.max(...live));
    });

    /**
     * The bound is the lane's, and it is doing work — remove it and this ride
     * really does overshoot. Declaring the same points on a lane whose own range
     * admits the overshoot is what separates "clamped correctly" from "the curve
     * never went there".
     */
    it('compiles the raw spline overshoot when the lane itself declares the range', () => {
        const lane = makeLane({ maxValue: 2 });

        const offline = offlineGainValues(lane);

        expect(Math.max(...offline)).toBeGreaterThan(1.07);
        expect(getAutomationLaneCeiling(lane)).toBe(2);
    });

    /**
     * The offline mirror of the live suite's segment-local bound.
     *
     * A lane-wide ceiling and live's segment-local one agree on every lane whose
     * raise either never fires or fires on the segment holding the peak, so a
     * lane has to be built where they part: one point drawn into the headroom,
     * and a plateau elsewhere that Catmull-Rom bends above the declared `1`
     * without either of its own bracketing points going there. Offline bounding
     * that plateau by the lane's maximum admits the overshoot the monitor
     * clamps, and the bounce comes back louder at the same playhead position.
     *
     * Compared value-to-value at one beat rather than maximum-to-maximum,
     * because two different bounds can share a maximum — this lane's is the
     * point at `1.995`, which both spellings pass through untouched.
     */
    it('bounds an offline segment by that segment’s own points, the way the monitor does', () => {
        const lane = makeLane({ points: SPLIT_HEADROOM_POINTS.map((point) => ({ ...point })) });
        seedLiveLane(lane);

        const live = getAutomationValueAtBeat(LANE_ID, PLATEAU_OVERSHOOT_BEAT);
        const offline = offlineGainValueAt(lane, PLATEAU_OVERSHOOT_SECONDS);

        // The plateau's own bracket is `0.97` on both sides, so the monitor
        // never raises this segment and holds the ~1.01571 overshoot at the
        // declared `1`. Pinned rather than merely compared, so a live path that
        // stopped clamping could not drag the parity assertion along with it.
        expect(live).toBe(1);
        expect(offline).toBe(live);
        // ...and the lane really does carry a raise, in the segment holding the
        // point drawn into the headroom. Without this the `1` above would be
        // indistinguishable from a lane the widening never touched.
        expect(offlineGainValueAt(lane, 0)).toBeCloseTo(1.995, 10);
        expect(getAutomationValueAtBeat(LANE_ID, 0)).toBeCloseTo(1.995, 10);
    });

    /**
     * The widened ceiling is genuinely reaching this lane, so the previous
     * case's `1` is the lane bound rather than a ceiling that never moved.
     */
    it('reads the legacy lane at the widened fader ceiling', () => {
        expect(getAutomationLaneCeiling(makeLane())).toBe(FADER_MAX_GAIN);
        expect(FADER_MAX_GAIN).toBeGreaterThan(1);
    });
});
