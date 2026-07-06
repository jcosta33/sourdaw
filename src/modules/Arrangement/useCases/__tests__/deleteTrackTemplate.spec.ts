import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TrackTemplate } from '../../models/TrackTemplate';
import { loadTrackTemplates } from '../../repositories/trackTemplate/loadTrackTemplates';
import { saveTrackTemplates } from '../../repositories/trackTemplate/saveTrackTemplates';
import { deleteTrackTemplate } from '../deleteTrackTemplate';
import { trackTemplateCache } from '../trackTemplate';

vi.mock('../../repositories/trackTemplate/loadTrackTemplates', () => ({
    loadTrackTemplates: vi.fn(),
}));

vi.mock('../../repositories/trackTemplate/saveTrackTemplates', () => ({
    saveTrackTemplates: vi.fn(),
}));

describe('deleteTrackTemplate', () => {
    function createTemplate(overrides: Partial<TrackTemplate> = {}): TrackTemplate {
        return {
            id: 'template-1',
            name: 'Template 1',
            category: 'User',
            trackKind: 'audio',
            devices: [],
            sends: [],
            gain: 0.8,
            pan: 0,
            color: '#ff0000',
            createdAt: 1_717_171_717,
            ...overrides,
        };
    }

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        trackTemplateCache.templates = null;
    });

    it('should delete a template through an immutable persisted cache replacement', () => {
        const firstTemplate = createTemplate({ id: 'template-1', name: 'First' });
        const secondTemplate = createTemplate({ id: 'template-2', name: 'Second' });
        const loadedTemplates = [firstTemplate, secondTemplate];
        vi.mocked(loadTrackTemplates).mockReturnValue(loadedTemplates);

        deleteTrackTemplate('template-1');

        const savedTemplates = vi.mocked(saveTrackTemplates).mock.calls[0]?.[0];
        if (!savedTemplates) {
            throw new Error('Expected saveTrackTemplates to receive templates');
        }

        expect(savedTemplates).toEqual([secondTemplate]);
        expect(savedTemplates).not.toBe(loadedTemplates);
        expect(trackTemplateCache.templates).toBe(savedTemplates);
        expect(loadedTemplates).toEqual([firstTemplate, secondTemplate]);
    });

    it('should delete from the existing cache without loading persisted templates', () => {
        const firstTemplate = createTemplate({ id: 'template-1', name: 'First' });
        const secondTemplate = createTemplate({ id: 'template-2', name: 'Second' });
        const cachedTemplates = [firstTemplate, secondTemplate];
        trackTemplateCache.templates = cachedTemplates;

        deleteTrackTemplate('template-2');

        expect(loadTrackTemplates).not.toHaveBeenCalled();
        expect(saveTrackTemplates).toHaveBeenCalledWith([firstTemplate]);
        expect(trackTemplateCache.templates).toEqual([firstTemplate]);
        expect(trackTemplateCache.templates).not.toBe(cachedTemplates);
    });
});
