import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRenameTrack } from '../renameTrack';

const mocks = vi.hoisted(() => ({
    renameTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; name: string }[] } | null>(),
}));

vi.mock('../../../useCases/renameTrack', () => ({
    renameTrack: mocks.renameTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleRenameTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
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
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous name', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', name: 'Old Name' }] });

        const desc = handleRenameTrack.describe({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'Lead' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'Old Name', expectedName: 'Lead' },
        });
        expect(desc.redoAction).toEqual({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'Lead', expectedName: 'Old Name' },
        });
    });

    it('refuses a guarded compensating rename after a collaborator changes the name', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', name: 'Collaborator Name' }] });

        const result = handleRenameTrack.execute({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'Old Name', expectedName: 'Lead' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.renameTrack).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleRenameTrack.undoable).toBe(true);
    });
});
