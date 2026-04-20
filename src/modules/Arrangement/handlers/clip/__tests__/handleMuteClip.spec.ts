import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMuteClip } from '../handleMuteClip';

const mocks = vi.hoisted(() => ({
    muteClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/muteClip', () => ({
    muteClip: mocks.muteClip,
}));

describe('handleMuteClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to muteClip use case', () => {
        void handleMuteClip.execute({
            type: 'muteClip',
            payload: { clipId: 'c1', muted: true },
        });
        expect(mocks.muteClip).toHaveBeenCalledWith('c1', true);
    });
});
