import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type FermenterPatch } from '../../../models/FermenterPatch';
import { saveUserPatch } from '../save-user-patch';

const STORAGE_KEY = 'fermenter-user-patches';

describe('saveUserPatch', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('should save with the existing storage key and plain JSON array shape', () => {
        vi.spyOn(Date, 'now').mockReturnValue(123_456);
        const patch: FermenterPatch = {
            ...DEFAULT_PATCH,
            filterCutoff: 8800,
            macros: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            name: 'Current patch',
        };

        expect(saveUserPatch({ name: 'Saved patch', patch })).toBe(true);

        const stored = window.localStorage.getItem(STORAGE_KEY);
        expect(JSON.parse(stored ?? 'null')).toEqual([
            {
                id: 'user-123456',
                name: 'Saved patch',
                patch: { ...patch, name: 'Saved patch' },
            },
        ]);
    });

    it('should append to sanitized existing user patches', () => {
        vi.spyOn(Date, 'now').mockReturnValue(55);
        const savedPatch: FermenterPatch = {
            ...DEFAULT_PATCH,
            name: 'Current patch',
            oscLevel: 0.45,
        };
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                { id: 404, name: 'Bad row', patch: { filterCutoff: 100 } },
                { id: 'existing', name: 'Existing patch', patch: { filterCutoff: 4400 } },
            ])
        );

        expect(saveUserPatch({ name: 'Saved patch', patch: savedPatch })).toBe(true);

        const stored = window.localStorage.getItem(STORAGE_KEY);
        expect(JSON.parse(stored ?? 'null')).toEqual([
            {
                id: 'existing',
                name: 'Existing patch',
                patch: { ...DEFAULT_PATCH, filterCutoff: 4400, name: 'Existing patch' },
            },
            {
                id: 'user-55',
                name: 'Saved patch',
                patch: { ...savedPatch, name: 'Saved patch' },
            },
        ]);
    });

    it('should return false when browser storage is missing', () => {
        vi.stubGlobal('window', undefined);

        expect(saveUserPatch({ name: 'Saved patch', patch: DEFAULT_PATCH })).toBe(false);
    });
});
