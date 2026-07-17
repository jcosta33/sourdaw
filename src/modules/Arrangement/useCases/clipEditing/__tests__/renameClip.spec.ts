import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renameClip } from '../renameClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('renameClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets the name', () => {
        renameClip('c1', 'New Name');
        const call = mocks.updateClip.mock.calls[0];
        if (!call) {
            throw new Error('expected updateClip to be called');
        }
        const updater = call[1];
        expect(updater({ name: 'Old' })).toEqual({ name: 'New Name' });
    });
});
