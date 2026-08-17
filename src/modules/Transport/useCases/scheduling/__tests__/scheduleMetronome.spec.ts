import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { resetMetronomeBeat } from '../resetMetronomeBeat';
import { scheduleMetronome } from '../scheduleMetronome';

type MutableStore = { value: { changes: unknown[] } | null };

const { tempoMapStore, timeSignatureMapStore } = vi.hoisted(
    (): { tempoMapStore: MutableStore; timeSignatureMapStore: MutableStore } => ({
        tempoMapStore: { value: { changes: [] } },
        timeSignatureMapStore: { value: { changes: [] } },
    })
);

vi.mock('../../../stores/tempoMapStore', () => ({ tempoMapStore }));
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCurrentTime: vi.fn(() => 0),
    scheduleClick: vi.fn(),
}));
// `TempoMap` and `TimeSignatureMap` are deliberately NOT stubbed. Both are pure
// leaves with their own specs, and the defects these tests pin are precisely
// about which quantity the metronome asks them for — a stub returning one flat
// tempo or one flat meter would answer the question the module gets wrong.

// getCurrentTime is mocked above; individual tests drive the audio clock through it.
const mockGetCurrentTime = vi.mocked(getCurrentTime);
const mockScheduleClick = vi.mocked(scheduleClick);

const metronomeOn = { ...defaultTransportState, metronomeEnabled: true };

describe('scheduleMetronome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tempoMapStore.value = { changes: [] };
        timeSignatureMapStore.value = { changes: [] };
        mockGetCurrentTime.mockReturnValue(0);
        // A reset far in the future prunes any dedup entries left by a prior test
        // (entries with a click time below now-epsilon are dropped) without relying
        // on cross-test module state. The reset itself only touches metronomeSchedulingState.lastBeat.
        mockGetCurrentTime.mockReturnValue(1e6);
        scheduleMetronome(0, -1, 0, metronomeOn); // no beats in range; prunes stale entries
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);
    });

    it('does not schedule clicks when the metronome is off', () => {
        scheduleMetronome(0, 4, 0, { ...defaultTransportState, metronomeEnabled: false });

        expect(scheduleClick).not.toHaveBeenCalled();
    });

    it('schedules one click per integer beat in the look-ahead window', () => {
        scheduleMetronome(0.5, 4.2, 0, metronomeOn);

        // beats 1,2,3,4 — beat 0 is below ceil(0.5)=1
        expect(mockScheduleClick).toHaveBeenCalledTimes(4);
    });

    it('does not re-fire a click at the same audio instant after a loop-wrap (regression: §B fix 2)', () => {
        // Pre-wrap tick: clock at 0, playhead ~3.9, look-ahead to 4.1 schedules beat 4
        // at time 0 + (4 - 3.9)/(120/60) = 0.05.
        mockGetCurrentTime.mockReturnValue(0);
        scheduleMetronome(3.75, 4.1, 3.9, metronomeOn);

        const preWrapCalls = mockScheduleClick.mock.calls.length;
        expect(preWrapCalls).toBe(1);
        expect(mockScheduleClick.mock.calls[0]![0]).toBeCloseTo(0.05, 6);

        // Wrap: the audio clock has advanced 0.05s to the loop boundary; the playhead
        // wraps to loopStart 0. resetMetronomeBeat(0) re-enables beat 0, whose time is
        // 0.05 + (0 - 0)/(120/60) = 0.05 — the SAME instant as the pre-wrap beat 4.
        mockGetCurrentTime.mockReturnValue(0.05);
        resetMetronomeBeat(0);
        scheduleMetronome(-0.0001, 0.2, 0, metronomeOn);

        // The coincident beat-0 click must be suppressed: still exactly one click total.
        expect(mockScheduleClick).toHaveBeenCalledTimes(preWrapCalls);
    });

    it('still fires the next loop iteration downbeat at a later instant', () => {
        // Beat 4 at clock 0 -> time 0.05.
        mockGetCurrentTime.mockReturnValue(0);
        scheduleMetronome(3.75, 4.1, 3.9, metronomeOn);
        expect(mockScheduleClick).toHaveBeenCalledTimes(1);

        // A later beat 0 whose resolved time is genuinely different (clock 2.0) must
        // sound — the dedup keys on the instant, not the beat number.
        mockGetCurrentTime.mockReturnValue(2.0);
        resetMetronomeBeat(0);
        scheduleMetronome(-0.0001, 0.2, 0, metronomeOn);
        expect(mockScheduleClick).toHaveBeenCalledTimes(2);
        expect(mockScheduleClick.mock.calls[1]![0]).toBeCloseTo(2.0, 6);
    });

    it('skips beats already scheduled on a prior tick (the lastBeat dedup continue)', () => {
        // First call advances lastBeat through beats 1..4.
        mockGetCurrentTime.mockReturnValue(0);
        scheduleMetronome(0.5, 4.2, 0, metronomeOn);
        const firstRun = mockScheduleClick.mock.calls.length;
        expect(firstRun).toBe(4);

        // A second overlapping call covering beats 3..6 must NOT re-fire beats 3 and 4
        // (they are <= lastBeat) — only the genuinely-new beats 5 and 6 sound.
        scheduleMetronome(2.5, 6.2, 0, metronomeOn);
        expect(mockScheduleClick.mock.calls.length).toBe(firstRun + 2);
        // With a 4-beat meter, accents fall on beats divisible by 4 (0, 4, 8...).
        // Beats 5 and 6 are both non-accent.
        expect(mockScheduleClick.mock.calls[firstRun]![1]).toBe(false);
        expect(mockScheduleClick.mock.calls[firstRun + 1]![1]).toBe(false);
    });

    it('integrates the tempo map across the window instead of using one flat tempo', () => {
        // 120 BPM from beat 0, doubling to 240 at beat 2. The playhead sits at
        // beat 0, so each click's offset spans both tempo segments.
        tempoMapStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 2, tempo: 240, curve: 'instant' },
            ],
        };
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);

        scheduleMetronome(0.5, 4.2, 0, metronomeOn);

        const times = mockScheduleClick.mock.calls.map((call) => call[0]);
        expect(times).toHaveLength(4);
        // beat 1: 1 beat at 120 = 0.5 s.
        expect(times[0]).toBeCloseTo(0.5, 9);
        // beat 2: 2 beats at 120 = 1.0 s. Reading the tempo *at* beat 2 (240) and
        // applying it back to the playhead gave 0.5 s — half a beat early.
        expect(times[1]).toBeCloseTo(1.0, 9);
        // beat 3: 1.0 s + 1 beat at 240 = 1.25 s (the flat reading gave 0.75 s).
        expect(times[2]).toBeCloseTo(1.25, 9);
        // beat 4: 1.0 s + 2 beats at 240 = 1.5 s (the flat reading gave 1.0 s).
        expect(times[3]).toBeCloseTo(1.5, 9);
    });

    it('accents the bar line the meter map implies, not a fixed modulo of the numerator', () => {
        // 3/4 from the origin, switching to 4/4 at beat 6. Real bar lines are the
        // quarter-note beats 0, 3, 6, 10. `beat % numerator === 0` instead accents
        // 0, 3 (by luck), then 8 and 12 — never 6 or 10.
        timeSignatureMapStore.value = {
            changes: [
                { id: 'a', beat: 0, numerator: 3, denominator: 4 },
                { id: 'b', beat: 6, numerator: 4, denominator: 4 },
            ],
        };
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);

        scheduleMetronome(-0.0001, 13.5, 0, metronomeOn);

        const accentedBeats = mockScheduleClick.mock.calls
            .map((call, index) => ({ beat: index, accent: call[1] }))
            .filter((entry) => entry.accent)
            .map((entry) => entry.beat);
        expect(mockScheduleClick).toHaveBeenCalledTimes(14); // beats 0..13
        expect(accentedBeats).toEqual([0, 3, 6, 10]);
    });

    it('accents on the bar length a non-quarter denominator implies', () => {
        // 6/8 with no map changes: a bar is 6 eighths = 3 quarter notes, so bar
        // lines fall on quarter-note beats 0, 3, 6, 9. Treating the numerator as
        // a count of quarter notes accented 0, 6 and 12 instead.
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);

        scheduleMetronome(-0.0001, 9.5, 0, {
            ...metronomeOn,
            timeSignatureNumerator: 6,
            timeSignatureDenominator: 8,
        });

        const accentedBeats = mockScheduleClick.mock.calls
            .map((call, index) => ({ beat: index, accent: call[1] }))
            .filter((entry) => entry.accent)
            .map((entry) => entry.beat);
        expect(accentedBeats).toEqual([0, 3, 6, 9]);
    });

    it('schedules clicks when the time-sig and tempo stores are null (fallback paths)', () => {
        // Both stores can be null before initial load. The `?? []` fallbacks must
        // yield empty change lists so the map queries fall back to the transport's
        // flat meter/tempo — clicks still schedule.
        tempoMapStore.value = null;
        timeSignatureMapStore.value = null;
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);

        scheduleMetronome(0.5, 2.2, 0, metronomeOn);

        // beats 1, 2 — both fire despite null stores.
        expect(mockScheduleClick).toHaveBeenCalledTimes(2);
    });
});
