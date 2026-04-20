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
        const updater = mocks.updateClip.mock.calls[0][1];
        expect(updater({ name: 'Old' })).toEqual({ name: 'New Name' });
    });
});
