import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateBus } from '../handleCreateBus';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: mocks.addTrack,
}));

describe('handleCreateBus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes addTrack with bus kind', () => {
        handleCreateBus.execute({
            type: 'createBus',
            payload: { name: 'Reverb Bus' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Reverb Bus', kind: 'bus' });
    });

    it('provides a description', () => {
        const desc = handleCreateBus.describe({
            type: 'createBus',
            payload: { name: 'Drum Bus' },
        });
        expect(desc.label).toBe('Create bus "Drum Bus"');
    });

    it('is undoable', () => {
        expect(handleCreateBus.undoable).toBe(true);
    });
});
