import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleLoadTrackTemplate } from '../handleLoadTrackTemplate';

const mocks = vi.hoisted(() => ({
    loadTrackTemplate: vi.fn(),
}));

vi.mock('../../../useCases/trackTemplate', () => ({
    loadTrackTemplate: mocks.loadTrackTemplate,
}));

describe('handleLoadTrackTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('is undoable', () => {
        expect(handleLoadTrackTemplate.undoable).toBe(true);
    });
});
