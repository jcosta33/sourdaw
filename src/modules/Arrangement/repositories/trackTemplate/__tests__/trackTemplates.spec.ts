import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type TrackTemplate } from '../../../models/TrackTemplate';
import { storage } from '../helpers';
import { loadTrackTemplates } from '../loadTrackTemplates';
import { saveTrackTemplates } from '../saveTrackTemplates';

vi.mock('../helpers', () => ({
    storage: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

describe('trackTemplate repository', () => {
    function createTemplate(overrides: Partial<TrackTemplate> = {}): TrackTemplate {
        return {
            id: 'template-1',
            name: 'Drums',
            category: 'Drums',
            trackKind: 'midi',
            devices: [],
            sends: [],
            gain: 0,
            pan: 0,
            color: '#ffcc00',
            createdAt: 1_717_171_717,
            ...overrides,
        };
    }

    function mockStoredTemplates(value: unknown): void {
        vi.mocked(storage.get).mockReturnValue(value as ReturnType<typeof storage.get>);
    }

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('loadTrackTemplates', () => {
        it('should return an empty array when nothing is saved', () => {
            vi.mocked(storage.get).mockReturnValue(null);
            expect(loadTrackTemplates()).toEqual([]);
        });

        it('should return the saved templates', () => {
            const templates = [createTemplate()];
            vi.mocked(storage.get).mockReturnValue(templates);
            expect(loadTrackTemplates()).toEqual(templates);
        });

        it('should return an empty array when stored data is not an array', () => {
            mockStoredTemplates({ id: 'template-1', name: 'Drums' });

            expect(loadTrackTemplates()).toEqual([]);
        });

        it('should drop invalid entries while preserving valid neighboring templates', () => {
            const firstTemplate = createTemplate({ id: 'template-1', name: 'First' });
            const secondTemplate = createTemplate({ id: 'template-2', name: 'Second', trackKind: 'audio' });

            mockStoredTemplates([
                firstTemplate,
                { ...createTemplate({ id: 'bad-kind' }), trackKind: 'invalid' },
                { ...createTemplate({ id: 'bad-gain' }), gain: Number.NaN },
                { ...createTemplate({ id: 'bad-devices' }), devices: null },
                'bad-template',
                secondTemplate,
            ]);

            expect(loadTrackTemplates()).toEqual([firstTemplate, secondTemplate]);
        });

        it('should return an empty array when malformed raw storage text is returned', () => {
            mockStoredTemplates('not-json');

            expect(loadTrackTemplates()).toEqual([]);
        });
    });

    describe('saveTrackTemplates', () => {
        it('should persist the given templates to storage', () => {
            const templates = [createTemplate()];
            saveTrackTemplates(templates);
            expect(storage.set).toHaveBeenCalledWith(templates);
        });
    });
});
