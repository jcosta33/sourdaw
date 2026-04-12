import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lockClip } from '../lockClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('lockClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets locked status', () => {
        lockClip('c1', true);
        const updater = mocks.updateClip.mock.calls[0][1];
        expect(updater({ locked: false })).toEqual({ locked: true });
    });
});
