import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMuteTrack } from '../muteTrack';

const mocks = vi.hoisted(() => ({
    muteTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/muteTrack', () => ({
    muteTrack: mocks.muteTrack,
}));

describe('handleMuteTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to muteTrack use case', () => {
        handleMuteTrack.execute({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
        expect(mocks.muteTrack).toHaveBeenCalledWith('t1', true);
    });
});
