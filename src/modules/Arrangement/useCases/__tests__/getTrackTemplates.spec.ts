import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TrackTemplate } from '../../models/TrackTemplate';
import { loadTrackTemplates } from '../../repositories/trackTemplate/loadTrackTemplates';
import { getTrackTemplates } from '../getTrackTemplates';
import { trackTemplateCache } from '../trackTemplate';

vi.mock('../../repositories/trackTemplate/loadTrackTemplates', () => ({
    loadTrackTemplates: vi.fn(),
}));

describe('getTrackTemplates', () => {
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

    it('should lazy-load templates once and return the cached array', () => {
        const loadedTemplates = [createTemplate()];
        vi.mocked(loadTrackTemplates).mockReturnValue(loadedTemplates);

        const firstRead = getTrackTemplates();
        const secondRead = getTrackTemplates();

        expect(firstRead).toBe(loadedTemplates);
        expect(secondRead).toBe(loadedTemplates);
        expect(loadTrackTemplates).toHaveBeenCalledTimes(1);
    });

    it('should return the existing cache without loading persisted templates', () => {
        const cachedTemplates = [createTemplate({ id: 'cached-template' })];
        trackTemplateCache.templates = cachedTemplates;

        expect(getTrackTemplates()).toBe(cachedTemplates);
        expect(loadTrackTemplates).not.toHaveBeenCalled();
    });
});
