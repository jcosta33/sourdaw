import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { estimateOnsetsFromClips, applyTempoMap, detectProjectTempo } from '../operations/detectProjectTempo';

const trackCell = vi.hoisted(() => ({
    value: null as { tracks: Array<{ kind: string; clips: Array<{ startBeat: number; endBeat: number }> }> } | null,
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: trackCell,
}));

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('estimateOnsetsFromClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackCell.value = null;
    });

    it('should return empty list when track store is empty', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        expect(estimateOnsetsFromClips()).toEqual([]);
    });

    it('should derive simulated onsets from midi clip spans', () => {
        trackCell.value = {
            tracks: [
                {
                    kind: 'midi',
                    clips: [{ startBeat: 0, endBeat: 2 }],
                },
            ],
        };

        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        const onsets = estimateOnsetsFromClips();

        expect(onsets.length).toBeGreaterThan(0);
        expect(onsets[0]).toBeLessThanOrEqual(onsets[onsets.length - 1]!);
    });
});

describe('applyTempoMap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not update when transport state is missing', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        applyTempoMap({
            points: [],
            averageBpm: 128,
            minBpm: 120,
            maxBpm: 130,
            confidence: 0.85,
            totalBeats: 16,
        });

        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should set tempo from average BPM when positive', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        applyTempoMap({
            points: [],
            averageBpm: 128.4,
            minBpm: 120,
            maxBpm: 130,
            confidence: 0.85,
            totalBeats: 16,
        });

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 128 });
    });
});

describe('detectProjectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackCell.value = null;
    });

    it('does not update transport when there are no MIDI onsets', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        detectProjectTempo();

        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('updates tempo when MIDI clips yield a confident tempo map', () => {
        trackCell.value = {
            tracks: [
                {
                    kind: 'midi',
                    clips: [{ startBeat: 0, endBeat: 16 }],
                },
            ],
        };
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        detectProjectTempo();

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 120 });
    });
});
