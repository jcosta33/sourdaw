import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type TrackTemplate } from '../../models/TrackTemplate';
import { getTrackById } from '../../repositories/track/getTrackById';
import { loadTrackTemplates } from '../../repositories/trackTemplate/loadTrackTemplates';
import { saveTrackTemplates } from '../../repositories/trackTemplate/saveTrackTemplates';
import { saveTrackAsTemplate } from '../saveTrackAsTemplate';
import { trackTemplateCache } from '../trackTemplate';

vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: vi.fn(),
}));

vi.mock('../../repositories/trackTemplate/loadTrackTemplates', () => ({
    loadTrackTemplates: vi.fn(),
}));

vi.mock('../../repositories/trackTemplate/saveTrackTemplates', () => ({
    saveTrackTemplates: vi.fn(),
}));

describe('saveTrackAsTemplate', () => {
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

    it('should return null without loading templates when the track is missing', () => {
        vi.mocked(getTrackById).mockReturnValue(undefined);

        const result = saveTrackAsTemplate('missing-track', 'Missing Track');

        expect(result).toBeNull();
        expect(loadTrackTemplates).not.toHaveBeenCalled();
        expect(saveTrackTemplates).not.toHaveBeenCalled();
        expect(trackTemplateCache.templates).toBeNull();
    });

    it('should save a cloned template with the default User category', () => {
        const loadedTemplates = [createTemplate({ id: 'existing-template', name: 'Existing' })];
        const device = {
            id: 'device-1',
            name: 'Synth',
            type: 'builtin-synth',
            bypassed: false,
            parameterValues: { cutoff: 0.5 },
        };
        const send = {
            busId: 'bus-1',
            level: 0.25,
            preFader: false,
        };
        const track = TrackDummy.create({
            id: 'track-1',
            name: 'Lead',
            kind: 'midi',
            devices: [device],
            sends: [send],
            gain: 0.6,
            pan: -0.2,
            color: '#00ffaa',
        });

        vi.mocked(getTrackById).mockReturnValue(track);
        vi.mocked(loadTrackTemplates).mockReturnValue(loadedTemplates);
        vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

        const result = saveTrackAsTemplate('track-1', 'Lead Template');

        if (result === null) {
            throw new Error('Expected saveTrackAsTemplate to return a template');
        }

        expect(result).toEqual({
            id: 'tmpl-11111111',
            name: 'Lead Template',
            category: 'User',
            createdAt: 1_800_000_000,
            trackKind: 'midi',
            devices: [device],
            sends: [send],
            gain: 0.6,
            pan: -0.2,
            color: '#00ffaa',
        });
        expect(result.devices[0]).not.toBe(device);
        expect(result.sends[0]).not.toBe(send);

        const savedTemplates = vi.mocked(saveTrackTemplates).mock.calls[0]?.[0];
        if (!savedTemplates) {
            throw new Error('Expected saveTrackTemplates to receive templates');
        }

        expect(savedTemplates).toEqual([loadedTemplates[0], result]);
        expect(savedTemplates).not.toBe(loadedTemplates);
        expect(trackTemplateCache.templates).toBe(savedTemplates);
        expect(loadedTemplates).toEqual([createTemplate({ id: 'existing-template', name: 'Existing' })]);
    });

    it('should append to the existing cache without reloading templates', () => {
        const cachedTemplates = [createTemplate({ id: 'cached-template', name: 'Cached' })];
        const track = TrackDummy.create({ id: 'track-1', name: 'Drums' });

        trackTemplateCache.templates = cachedTemplates;
        vi.mocked(getTrackById).mockReturnValue(track);
        vi.spyOn(Date, 'now').mockReturnValue(1_800_000_001);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('22222222-2222-4222-8222-222222222222');

        const result = saveTrackAsTemplate('track-1', 'Drums Template', 'Drums');

        if (result === null) {
            throw new Error('Expected saveTrackAsTemplate to return a template');
        }

        expect(loadTrackTemplates).not.toHaveBeenCalled();
        expect(saveTrackTemplates).toHaveBeenCalledWith([cachedTemplates[0], result]);
        expect(trackTemplateCache.templates).toEqual([cachedTemplates[0], result]);
        expect(trackTemplateCache.templates).not.toBe(cachedTemplates);
        expect(result.category).toBe('Drums');
    });
});
