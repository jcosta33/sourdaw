import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDeleteTrackTemplate } from '../handleDeleteTrackTemplate';

const mocks = vi.hoisted(() => ({
    deleteTrackTemplate: vi.fn(),
}));

vi.mock('../../../useCases/trackTemplate', () => ({
    deleteTrackTemplate: mocks.deleteTrackTemplate,
}));

describe('handleDeleteTrackTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes deleteTrackTemplate', () => {
        void handleDeleteTrackTemplate.execute({
            type: 'deleteTrackTemplate',
            payload: { templateId: 'tmpl-1' },
        });

        expect(mocks.deleteTrackTemplate).toHaveBeenCalledWith('tmpl-1');
    });

    it('provides a description', () => {
        const desc = handleDeleteTrackTemplate.describe({
            type: 'deleteTrackTemplate',
            payload: { templateId: '' },
        });
        expect(desc.label).toBe('Delete Track Template');
    });

    it('is not undoable', () => {
        expect(handleDeleteTrackTemplate.undoable).toBe(false);
    });
});
