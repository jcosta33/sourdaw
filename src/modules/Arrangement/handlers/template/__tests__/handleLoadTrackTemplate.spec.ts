import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleLoadTrackTemplate } from '../handleLoadTrackTemplate';

const mocks = vi.hoisted(() => ({
    loadTrackTemplate: vi.fn(),
    getTrackStoreState: vi.fn(),
    captureTrackRemovalSnapshot: vi.fn(),
}));

vi.mock('../../../useCases/loadTrackTemplate', () => ({
    loadTrackTemplate: mocks.loadTrackTemplate,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/captureTrackRemovalSnapshot', () => ({
    captureTrackRemovalSnapshot: mocks.captureTrackRemovalSnapshot,
}));

describe('handleLoadTrackTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.captureTrackRemovalSnapshot.mockImplementation((trackId: string) => ({ trackId }));
    });

    it('executes loadTrackTemplate', () => {
        void handleLoadTrackTemplate.execute({
            type: 'loadTrackTemplate',
            payload: { templateId: 'tmpl-1' },
        });

        expect(mocks.loadTrackTemplate).toHaveBeenCalledWith('tmpl-1');
    });

    it('provides a description', () => {
        const desc = handleLoadTrackTemplate.describe({
            type: 'loadTrackTemplate',
            payload: { templateId: '' },
        });
        expect(desc.label).toBe('Load Track Template');
    });

    it('records exactly the ids the template appended, diffing the track store around execute', () => {
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'existing' }] })
            .mockReturnValueOnce({ tracks: [{ id: 'existing' }, { id: 'created-1' }, { id: 'created-2' }] });

        const action = { type: 'loadTrackTemplate' as const, payload: { templateId: 'tmpl-1' } };

        const desc = handleLoadTrackTemplate.describe(action);
        const result = handleLoadTrackTemplate.execute(action);

        expect(result).toEqual({ status: 'written' });
        expect(desc.inverseAction).toEqual({
            type: 'discardCreatedTracks',
            payload: { trackIds: ['created-1', 'created-2'] },
        });
        // Redo restores those exact ids instead of replaying the template, which mints
        // fresh ones and would strand the inverse above on ids nothing holds.
        expect(desc.redoAction).toEqual({
            type: 'restoreTracks',
            payload: { restores: [{ trackId: 'created-1' }, { trackId: 'created-2' }] },
        });
    });

    it('emits neither inverse nor redo when a created track could not be snapshotted', () => {
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'existing' }] })
            .mockReturnValueOnce({ tracks: [{ id: 'existing' }, { id: 'created-1' }] });
        mocks.captureTrackRemovalSnapshot.mockReturnValue(null);

        const action = { type: 'loadTrackTemplate' as const, payload: { templateId: 'tmpl-1' } };

        const desc = handleLoadTrackTemplate.describe(action);
        handleLoadTrackTemplate.execute(action);

        expect(desc.inverseAction).toBeNull();
        expect(desc.redoAction).toBeUndefined();
    });

    it('emits no inverse and reports no-write when the template appends nothing', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'existing' }] });

        const action = { type: 'loadTrackTemplate' as const, payload: { templateId: 'missing-template' } };

        const desc = handleLoadTrackTemplate.describe(action);
        const result = handleLoadTrackTemplate.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleLoadTrackTemplate.undoable).toBe(true);
    });
});
