import { beforeEach, describe, expect, it } from 'vitest';

import { type TrackTemplate } from '../../models/TrackTemplate';
import { trackTemplateCache } from '../trackTemplate';

describe('trackTemplate', () => {
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
        trackTemplateCache.templates = null;
    });

    it('should expose an unloaded template cache by default', () => {
        expect(trackTemplateCache.templates).toBeNull();
    });

    it('should hold immutable cache replacements by reference', () => {
        const firstTemplates = [createTemplate({ id: 'template-1' })];
        trackTemplateCache.templates = firstTemplates;

        const nextTemplates = [...firstTemplates, createTemplate({ id: 'template-2' })];
        trackTemplateCache.templates = nextTemplates;

        expect(trackTemplateCache.templates).toBe(nextTemplates);
        expect(firstTemplates).toEqual([createTemplate({ id: 'template-1' })]);
    });
});
