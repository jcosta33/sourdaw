import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleMetronome } from '../scheduleMetronome';
import { defaultTransportState } from '../../../models/TransportState';
import { scheduleClick } from '#/modules/AudioEngine/useCases';

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

describe('scheduleMetronome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not schedule clicks when the metronome is off', () => {
        scheduleMetronome(0, 4, 0, { ...defaultTransportState, metronomeEnabled: false }, 120);

        expect(scheduleClick).not.toHaveBeenCalled();
    });
});
