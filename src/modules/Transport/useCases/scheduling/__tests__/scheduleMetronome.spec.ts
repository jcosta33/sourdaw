import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { resetMetronomeBeat } from '../resetMetronomeBeat';
import { scheduleMetronome } from '../scheduleMetronome';

vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCurrentTime: vi.fn(() => 0),
    scheduleClick: vi.fn(),
}));
vi.mock('../../models/TimeSignatureMap', () => ({
    getTimeSignatureAtBeat: vi.fn(() => ({ numerator: 4, denominator: 4 })),
}));

// getCurrentTime is mocked above; individual tests drive the audio clock through it.
const mockGetCurrentTime = vi.mocked(getCurrentTime);
const mockScheduleClick = vi.mocked(scheduleClick);

const metronomeOn = { ...defaultTransportState, metronomeEnabled: true };

describe('scheduleMetronome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCurrentTime.mockReturnValue(0);
        // A reset far in the future prunes any dedup entries left by a prior test
        // (entries with a click time below now-epsilon are dropped) without relying
        // on cross-test module state. The reset itself only touches metronomeSchedulingState.lastBeat.
        mockGetCurrentTime.mockReturnValue(1e6);
        scheduleMetronome(0, -1, 0, metronomeOn, 120); // no beats in range; prunes stale entries
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);
    });

    it('does not schedule clicks when the metronome is off', () => {
        scheduleMetronome(0, 4, 0, { ...defaultTransportState, metronomeEnabled: false }, 120);

        expect(scheduleClick).not.toHaveBeenCalled();
    });

    it('schedules one click per integer beat in the look-ahead window', () => {
        scheduleMetronome(0.5, 4.2, 0, metronomeOn, 120);

        // beats 1,2,3,4 — beat 0 is below ceil(0.5)=1
        expect(mockScheduleClick).toHaveBeenCalledTimes(4);
    });

    it('does not re-fire a click at the same audio instant after a loop-wrap (regression: §B fix 2)', () => {
        // Pre-wrap tick: clock at 0, playhead ~3.9, look-ahead to 4.1 schedules beat 4
        // at time 0 + (4 - 3.9)/(120/60) = 0.05.
        mockGetCurrentTime.mockReturnValue(0);
        scheduleMetronome(3.75, 4.1, 3.9, metronomeOn, 120);

        const preWrapCalls = mockScheduleClick.mock.calls.length;
        expect(preWrapCalls).toBe(1);
        expect(mockScheduleClick.mock.calls[0]![0]).toBeCloseTo(0.05, 6);

        // Wrap: the audio clock has advanced 0.05s to the loop boundary; the playhead
        // wraps to loopStart 0. resetMetronomeBeat(0) re-enables beat 0, whose time is
        // 0.05 + (0 - 0)/(120/60) = 0.05 — the SAME instant as the pre-wrap beat 4.
        mockGetCurrentTime.mockReturnValue(0.05);
        resetMetronomeBeat(0);
        scheduleMetronome(-0.0001, 0.2, 0, metronomeOn, 120);

        // The coincident beat-0 click must be suppressed: still exactly one click total.
        expect(mockScheduleClick).toHaveBeenCalledTimes(preWrapCalls);
    });

    it('still fires the next loop iteration downbeat at a later instant', () => {
        // Beat 4 at clock 0 -> time 0.05.
        mockGetCurrentTime.mockReturnValue(0);
        scheduleMetronome(3.75, 4.1, 3.9, metronomeOn, 120);
        expect(mockScheduleClick).toHaveBeenCalledTimes(1);

        // A later beat 0 whose resolved time is genuinely different (clock 2.0) must
        // sound — the dedup keys on the instant, not the beat number.
        mockGetCurrentTime.mockReturnValue(2.0);
        resetMetronomeBeat(0);
        scheduleMetronome(-0.0001, 0.2, 0, metronomeOn, 120);
        expect(mockScheduleClick).toHaveBeenCalledTimes(2);
        expect(mockScheduleClick.mock.calls[1]![0]).toBeCloseTo(2.0, 6);
    });
});
