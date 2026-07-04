import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type FermenterMacroMapping } from '../../../models/FermenterPatch';
import { loadUserPatches } from '../load-user-patches';

const STORAGE_KEY = 'fermenter-user-patches';

function createValidMacroMappings(): FermenterMacroMapping[] {
    return [
        {
            targets: [
                {
                    target: 'filterCutoff',
                    center: 2_400,
                    depth: 1_200,
                    min: 120,
                    max: 6_000,
                    curve: 'exponential',
                },
            ],
        },
        { targets: [{ target: 'distMix', center: 0.2, depth: 0.2, min: 0, max: 0.4, curve: 'linear' }] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
        { targets: [] },
    ];
}

describe('loadUserPatches', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        window.localStorage.clear();
        vi.clearAllMocks();
    });

    it('should load only rows with string id, string name, and patch object', () => {
        const storedMacros = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                { id: 123, name: 'Bad id', patch: { filterCutoff: 111 } },
                { id: 'bad-name', name: null, patch: { filterCutoff: 222 } },
                { id: 'bad-patch', name: 'Bad patch', patch: null },
                ['array-row'],
                {
                    id: 'valid',
                    name: 'Row name wins',
                    patch: {
                        filterCutoff: 7600,
                        macros: storedMacros,
                        masterGain: null,
                        name: 'Ignored patch name',
                        oscLevel: 'loud',
                        version: 2,
                    },
                },
            ])
        );

        const userPatches = loadUserPatches();

        expect(userPatches).toHaveLength(1);
        expect(userPatches[0]?.id).toBe('valid');
        expect(userPatches[0]?.name).toBe('Row name wins');
        expect(userPatches[0]?.patch.name).toBe('Row name wins');
        expect(userPatches[0]?.patch.version).toBe(2);
        expect(userPatches[0]?.patch.filterCutoff).toBe(7600);
        expect(userPatches[0]?.patch.oscLevel).toBe(DEFAULT_PATCH.oscLevel);
        expect(userPatches[0]?.patch.masterGain).toBe(DEFAULT_PATCH.masterGain);
        expect(userPatches[0]?.patch.macros).toEqual(storedMacros);
    });

    it('should preserve valid custom macro mappings', () => {
        const macroMappings = createValidMacroMappings();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                {
                    id: 'custom-macros',
                    name: 'Custom macros',
                    patch: {
                        macroMappings,
                    },
                },
            ])
        );

        const userPatches = loadUserPatches();

        expect(userPatches).toHaveLength(1);
        expect(userPatches[0]?.patch.macroMappings).toEqual(macroMappings);
        expect(userPatches[0]?.patch.macroMappings).not.toBe(DEFAULT_PATCH.macroMappings);
        expect(userPatches[0]?.patch.macroMappings?.[0]).not.toBe(DEFAULT_PATCH.macroMappings?.[0]);
    });

    it('should hydrate invalid numeric fields and invalid macros from defaults', () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                {
                    id: 'defaults',
                    name: 'Defaults',
                    patch: {
                        filterCutoff: 'bright',
                        macroMappings: [
                            { targets: [{ target: 'name', center: 0, depth: 1, min: 0, max: 1, curve: 'linear' }] },
                        ],
                        macros: [0.1, 0.2, 0.3],
                        masterGain: null,
                    },
                },
            ])
        );

        const userPatches = loadUserPatches();

        expect(userPatches).toHaveLength(1);
        expect(userPatches[0]?.patch.filterCutoff).toBe(DEFAULT_PATCH.filterCutoff);
        expect(userPatches[0]?.patch.masterGain).toBe(DEFAULT_PATCH.masterGain);
        expect(userPatches[0]?.patch.macros).toEqual(DEFAULT_PATCH.macros);
        expect(userPatches[0]?.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        expect(userPatches[0]?.patch.macroMappings).not.toBe(DEFAULT_PATCH.macroMappings);
        expect(userPatches[0]?.patch.macroMappings?.[0]).not.toBe(DEFAULT_PATCH.macroMappings?.[0]);
    });

    it('should hydrate invalid JSON, invalid top-level values, and missing browser storage to empty lists', () => {
        expect(loadUserPatches()).toEqual([]);

        const invalidStoredValues = ['{invalid', '"patch"', '{"0":{"id":"x"}}', '7', 'false', 'null'];
        for (const storedValue of invalidStoredValues) {
            window.localStorage.setItem(STORAGE_KEY, storedValue);

            expect(loadUserPatches()).toEqual([]);
        }

        vi.stubGlobal('window', undefined);

        expect(loadUserPatches()).toEqual([]);
    });
});
