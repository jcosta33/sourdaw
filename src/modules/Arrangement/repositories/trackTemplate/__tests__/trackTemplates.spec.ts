import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('loadTrackTemplates', () => {
        it('should return an empty array when nothing is saved', () => {
            vi.mocked(storage.get).mockReturnValue(null);
            expect(loadTrackTemplates()).toEqual([]);
        });

        it('should return the saved templates', () => {
            const templates = [{ id: 't1', name: 'Drums' }];
            vi.mocked(storage.get).mockReturnValue(templates as any);
            expect(loadTrackTemplates()).toEqual(templates);
        });
    });

    describe('saveTrackTemplates', () => {
        it('should persist the given templates to storage', () => {
            const templates = [{ id: 't1', name: 'Drums' }];
            saveTrackTemplates(templates as any);
            expect(storage.set).toHaveBeenCalledWith(templates);
        });
    });
});
