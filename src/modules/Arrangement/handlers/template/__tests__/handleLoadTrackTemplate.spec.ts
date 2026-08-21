import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleLoadTrackTemplate } from '../handleLoadTrackTemplate';

const mocks = vi.hoisted(() => ({
    loadTrackTemplate: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/loadTrackTemplate', () => ({
    loadTrackTemplate: mocks.loadTrackTemplate,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleLoadTrackTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
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
