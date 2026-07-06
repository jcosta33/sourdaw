import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSaveTrackTemplate } from '../handleSaveTrackTemplate';

const mocks = vi.hoisted(() => ({
    saveTrackAsTemplate: vi.fn(),
}));

vi.mock('../../../useCases/saveTrackAsTemplate', () => ({
    saveTrackAsTemplate: mocks.saveTrackAsTemplate,
}));

describe('handleSaveTrackTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes saveTrackAsTemplate', () => {
        void handleSaveTrackTemplate.execute({
            type: 'saveTrackTemplate',
            payload: { trackId: 't1', name: 'My Tmpl', category: 'Drums' },
        });

        expect(mocks.saveTrackAsTemplate).toHaveBeenCalledWith('t1', 'My Tmpl', 'Drums');
    });

    it('provides a description', () => {
        const desc = handleSaveTrackTemplate.describe({
            type: 'saveTrackTemplate',
            payload: { trackId: '', name: '', category: '' },
        });
        expect(desc.label).toBe('Save Track Template');
    });

    it('is not undoable', () => {
        expect(handleSaveTrackTemplate.undoable).toBe(false);
    });
});
