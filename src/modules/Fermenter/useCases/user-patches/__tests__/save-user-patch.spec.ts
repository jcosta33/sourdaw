import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type FermenterMacroMapping, type FermenterPatch } from '../../../models/FermenterPatch';
import { saveUserPatch } from '../save-user-patch';

const STORAGE_KEY = 'fermenter-user-patches';

function createValidMacroMappings(): FermenterMacroMapping[] {
    return [
        {
            targets: [
                {
                    target: 'filterCutoff',
                    center: 3_200,
                    depth: 1_800,
                    min: 140,
                    max: 8_000,
                    curve: 'exponential',
                },
            ],
        },
        { targets: [{ target: 'distMix', center: 0.3, depth: 0.2, min: 0, max: 0.5, curve: 'linear' }] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
    ];
}

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
        const existingMacroMappings = createValidMacroMappings();
        const savedPatch: FermenterPatch = {
            ...DEFAULT_PATCH,
            name: 'Current patch',
            oscLevel: 0.45,
        };
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                { id: 404, name: 'Bad row', patch: { filterCutoff: 100 } },
                {
                    id: 'existing',
                    name: 'Existing patch',
                    patch: { filterCutoff: 4400, macroMappings: existingMacroMappings },
                },
            ])
        );

        expect(saveUserPatch({ name: 'Saved patch', patch: savedPatch })).toBe(true);

        const stored = window.localStorage.getItem(STORAGE_KEY);
        expect(JSON.parse(stored ?? 'null')).toEqual([
            {
                id: 'existing',
                name: 'Existing patch',
                patch: {
                    ...DEFAULT_PATCH,
                    filterCutoff: 4400,
                    macroMappings: existingMacroMappings,
                    name: 'Existing patch',
                },
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

    it('should return false when JSON serialization fails', () => {
        const patch: FermenterPatch = {
            ...DEFAULT_PATCH,
            name: 'Current patch',
        };
        Object.defineProperty(patch, 'self', {
            enumerable: true,
            value: patch,
        });

        expect(saveUserPatch({ name: 'Saved patch', patch })).toBe(false);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
