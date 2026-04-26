import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRenameTrack } from '../renameTrack';

const mocks = vi.hoisted(() => ({
    renameTrack: vi.fn(),
}));

vi.mock('../../../useCases/renameTrack', () => ({
    renameTrack: mocks.renameTrack,
}));

describe('handleRenameTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes renameTrack with the provided payload', () => {
        void handleRenameTrack.execute({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'Vocals' },
        });

        expect(mocks.renameTrack).toHaveBeenCalledWith('t1', 'Vocals');
    });

    it('provides a description reflecting the name', () => {
        const desc = handleRenameTrack.describe({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'Lead' },
        });
        expect(desc.label).toBe('Rename track to "Lead"');
    });

    it('is undoable', () => {
        expect(handleRenameTrack.undoable).toBe(true);
    });
});
