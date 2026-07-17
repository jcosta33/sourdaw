import { describe, it, expect, vi, beforeEach } from 'vitest';

import { muteClip } from '../muteClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('muteClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets muted status', () => {
        muteClip('c1', true);
        const call = mocks.updateClip.mock.calls[0];
        if (!call) {
            throw new Error('expected updateClip to be called');
        }
        const updater = call[1];
        expect(updater({ muted: false })).toEqual({ muted: true });
    });
});
