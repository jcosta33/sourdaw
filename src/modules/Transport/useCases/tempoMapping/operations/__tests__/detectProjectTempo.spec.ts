import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../../models/TransportState';
import { getTransportState } from '../../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../../repositories/transport/updateTransportState';
import { detectProjectTempo } from '../detectProjectTempo';

const trackCell = vi.hoisted(() => ({
    value: null as { tracks: Array<{ kind: string; clips: Array<{ startBeat: number; endBeat: number }> }> } | null,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackCell,
}));

vi.mock('../../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

vi.mock('../../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('detectProjectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackCell.value = null;
    });

    it('should not update transport when there are no MIDI onsets', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        const result = detectProjectTempo();

        expect(result.confidence).toBe(0);
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should update tempo when MIDI clips yield a confident tempo map', () => {
        trackCell.value = {
            tracks: [
                {
                    kind: 'midi',
                    clips: [{ startBeat: 0, endBeat: 16 }],
                },
            ],
        };
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        const result = detectProjectTempo();

        expect(result.averageBpm).toBe(120);
        expect(result.confidence).toBeGreaterThan(0.5);
        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 120 });
    });
});
