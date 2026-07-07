import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { applyTempoMap } from '../operations/applyTempoMap';
import { detectProjectTempo } from '../operations/detectProjectTempo';
import { estimateOnsetsFromClips } from '../operations/estimateOnsetsFromClips';

const trackCell = vi.hoisted(() => ({
    value: null as { tracks: Array<{ kind: string; clips: Array<{ startBeat: number; endBeat: number }> }> } | null,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
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

    it('should derive sorted onsets from midi clip spans using the current tempo', () => {
        trackCell.value = {
            tracks: [
                {
                    kind: 'midi',
                    clips: [
                        { startBeat: 2, endBeat: 4 },
                        { startBeat: 0, endBeat: 2 },
                    ],
                },
                {
                    kind: 'audio',
                    clips: [{ startBeat: 10, endBeat: 12 }],
                },
            ],
        };

        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 60 });

        const onsets = estimateOnsetsFromClips();

        expect(onsets).toEqual([0, 1, 2, 3]);
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

    it('should not update when average BPM is zero', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        applyTempoMap({
            points: [],
            averageBpm: 0,
            minBpm: 0,
            maxBpm: 0,
            confidence: 0,
            totalBeats: 0,
        });

        expect(updateTransportState).not.toHaveBeenCalled();
    });
});

describe('detectProjectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackCell.value = null;
    });

    it('should not update transport when there are no MIDI onsets', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });

        detectProjectTempo();

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

        detectProjectTempo();

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 120 });
    });
});
