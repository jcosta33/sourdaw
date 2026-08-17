import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { resetMetronomeBeat } from '../resetMetronomeBeat';
import { scheduleMetronome } from '../scheduleMetronome';

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCurrentTime: vi.fn(() => 0),
    scheduleClick: vi.fn(),
}));
// The tempo and meter models run for real against the empty maps above, so
// every conversion falls back to `defaultTransportState` (120 BPM, 4/4).

const mockGetCurrentTime = vi.mocked(getCurrentTime);
const metronomeOn = { ...defaultTransportState, metronomeEnabled: true };

describe('resetMetronomeBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCurrentTime.mockReturnValue(1e6);
        scheduleMetronome(0, -1, 0, metronomeOn);
        mockGetCurrentTime.mockReturnValue(0);
        resetMetronomeBeat(0);
    });

    it('should allow a later downbeat after resetting the tracked beat', () => {
        scheduleMetronome(0, 0, 0, metronomeOn);
        expect(scheduleClick).toHaveBeenCalledTimes(1);

        scheduleMetronome(0, 0, 0, metronomeOn);
        expect(scheduleClick).toHaveBeenCalledTimes(1);

        mockGetCurrentTime.mockReturnValue(2);
        resetMetronomeBeat(0);
        scheduleMetronome(0, 0, 0, metronomeOn);

        expect(scheduleClick).toHaveBeenCalledTimes(2);
        expect(vi.mocked(scheduleClick).mock.calls[1]![0]).toBeCloseTo(2, 6);
    });
});
