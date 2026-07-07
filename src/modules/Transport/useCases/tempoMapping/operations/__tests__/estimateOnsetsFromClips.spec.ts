import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../../models/TransportState';
import { getTransportState } from '../../../../repositories/transport/getTransportState';
import { estimateOnsetsFromClips } from '../estimateOnsetsFromClips';

const trackCell = vi.hoisted(() => ({
    value: null as { tracks: Array<{ kind: string; clips: Array<{ startBeat: number; endBeat: number }> }> } | null,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackCell,
}));

vi.mock('../../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
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

        expect(estimateOnsetsFromClips()).toEqual([0, 1, 2, 3]);
    });
});
