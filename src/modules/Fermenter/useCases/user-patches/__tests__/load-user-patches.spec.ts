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

    describe('macro target sanitization (per-field rejection)', () => {
        // Each case hits one rejection branch inside sanitizeMacroTarget; the
        // whole mapping falls back to DEFAULT_MACRO_MAPPINGS when any target
        // field is invalid.
        const baseTarget = { target: 'filterCutoff', center: 0, depth: 1, min: 0, max: 1, curve: 'linear' };

        function withBadTarget(overrides: Record<string, unknown>): void {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'row',
                        name: 'Row',
                        patch: {
                            macroMappings: [{ targets: [{ ...baseTarget, ...overrides }] }],
                        },
                    },
                ])
            );
        }

        it('rejects a target whose target is not a known numeric patch key', () => {
            withBadTarget({ target: 'noSuchParam' });
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a target whose center is not a finite number', () => {
            withBadTarget({ center: Infinity });
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a target whose depth is not a finite number', () => {
            withBadTarget({ depth: 'deep' });
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a target whose min is not a finite number', () => {
            withBadTarget({ min: NaN });
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a target whose max is not a finite number', () => {
            withBadTarget({ max: null });
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a target whose curve is neither linear nor exponential', () => {
            withBadTarget({ curve: 'logarithmic' });
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });
    });

    describe('macro mapping sanitization', () => {
        it('falls back to defaults when macroMappings is not an array', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { macroMappings: 'nope' } }])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('falls back to defaults when macroMappings does not have exactly eight entries', () => {
            // seven entries → wrong length → defaults.
            const seven = Array.from({ length: 7 }, () => ({ targets: [] }));
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { macroMappings: seven } }])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('falls back to defaults when a macro mapping is not an object', () => {
            const mappings: FermenterMacroMapping[] = Array.from({ length: 8 }, () => ({ targets: [] }));
            mappings[3] = 'not-an-object' as unknown as FermenterMacroMapping;
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { macroMappings: mappings } }])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('falls back to defaults when a macro mapping has no targets array', () => {
            const mappings: FermenterMacroMapping[] = Array.from({ length: 8 }, () => ({ targets: [] }));
            mappings[5] = { targets: 'not-array' } as unknown as FermenterMacroMapping;
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { macroMappings: mappings } }])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });
    });

    describe('macros tuple sanitization', () => {
        it('keeps a valid 8-element finite-number macros tuple', () => {
            const macros = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'r', name: 'n', patch: { macros } }]));
            expect(loadUserPatches()[0]!.patch.macros).toEqual(macros);
        });

        it('falls back to default macros when the tuple contains a non-number', () => {
            const macros = [0.1, 0.2, 'x', 0.4, 0.5, 0.6, 0.7, 0.8];
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'r', name: 'n', patch: { macros } }]));
            expect(loadUserPatches()[0]!.patch.macros).toEqual(DEFAULT_PATCH.macros);
        });

        it('falls back to default macros when the tuple contains a non-finite number', () => {
            const macros = [0.1, 0.2, Infinity, 0.4, 0.5, 0.6, 0.7, 0.8];
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'r', name: 'n', patch: { macros } }]));
            expect(loadUserPatches()[0]!.patch.macros).toEqual(DEFAULT_PATCH.macros);
        });

        it('falls back to default macros when the tuple is not length 8', () => {
            const macros = [0.1, 0.2, 0.3];
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'r', name: 'n', patch: { macros } }]));
            expect(loadUserPatches()[0]!.patch.macros).toEqual(DEFAULT_PATCH.macros);
        });

        it('falls back to default macros when macros is not an array', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { macros: 'nope' } }])
            );
            expect(loadUserPatches()[0]!.patch.macros).toEqual(DEFAULT_PATCH.macros);
        });
    });

    describe('patch numeric field sanitization', () => {
        it('skips a stored numeric field whose value is not finite', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { filterCutoff: NaN, oscLevel: Infinity } }])
            );
            const patch = loadUserPatches()[0]!.patch;
            expect(patch.filterCutoff).toBe(DEFAULT_PATCH.filterCutoff);
            expect(patch.oscLevel).toBe(DEFAULT_PATCH.oscLevel);
        });

        it('skips a stored field whose key is not a numeric patch key', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { unknownField: 42 } }])
            );
            // Unknown key is ignored; default patch is returned otherwise intact.
            const patch = loadUserPatches()[0]!.patch;
            expect((patch as unknown as Record<string, unknown>).unknownField).toBeUndefined();
        });
    });

    describe('row sanitization', () => {
        it('rejects a row that is not an object', () => {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['string-row', 42, null]));
            expect(loadUserPatches()).toEqual([]);
        });

        it('rejects a row whose id is missing', () => {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ name: 'n', patch: {} }]));
            expect(loadUserPatches()).toEqual([]);
        });

        it('rejects a row whose patch is not an object', () => {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'r', name: 'n', patch: 'not-object' }]));
            expect(loadUserPatches()).toEqual([]);
        });

        it('coerces a valid exponential-curve target through the curve guard', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                {
                                    targets: [
                                        {
                                            target: 'filterCutoff',
                                            center: 1,
                                            depth: 1,
                                            min: 0,
                                            max: 2,
                                            curve: 'exponential',
                                        },
                                    ],
                                },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            const mapping = loadUserPatches()[0]!.patch.macroMappings![0]!.targets[0]!;
            expect(mapping.curve).toBe('exponential');
        });

        it('rejects a macro target that is not an object (string, number, null, array)', () => {
            for (const badTarget of ['string', 42, null, ['array']]) {
                window.localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify([
                        {
                            id: 'r',
                            name: 'n',
                            patch: {
                                macroMappings: [
                                    { targets: [badTarget] },
                                    ...Array.from({ length: 7 }, () => ({ targets: [] })),
                                ],
                            },
                        },
                    ])
                );
                expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
            }
        });

        it('rejects a macro target whose target field is not a string', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                { targets: [{ target: 42, center: 0, depth: 1, min: 0, max: 1, curve: 'linear' }] },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a macro target whose center is not a number (string)', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                {
                                    targets: [
                                        { target: 'filterCutoff', center: 'bright', depth: 1, min: 0, max: 1, curve: 'linear' },
                                    ],
                                },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a macro target whose depth is not a number (boolean)', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                {
                                    targets: [
                                        { target: 'filterCutoff', center: 0, depth: true, min: 0, max: 1, curve: 'linear' },
                                    ],
                                },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a macro target whose min is not a number (string)', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                {
                                    targets: [
                                        { target: 'filterCutoff', center: 0, depth: 1, min: 'low', max: 1, curve: 'linear' },
                                    ],
                                },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a macro target whose max is not a number (string)', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                {
                                    targets: [
                                        { target: 'filterCutoff', center: 0, depth: 1, min: 0, max: 'high', curve: 'linear' },
                                    ],
                                },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a macro target whose curve is not a string', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([
                    {
                        id: 'r',
                        name: 'n',
                        patch: {
                            macroMappings: [
                                {
                                    targets: [
                                        { target: 'filterCutoff', center: 0, depth: 1, min: 0, max: 1, curve: 5 },
                                    ],
                                },
                                ...Array.from({ length: 7 }, () => ({ targets: [] })),
                            ],
                        },
                    },
                ])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });

        it('rejects a macro target inside a mapping that is itself not an object', () => {
            const mappings = Array.from({ length: 8 }, () => ({ targets: [] }));
            // A target entry that is a primitive exercises isJsonObject→false inside sanitizeMacroTarget
            (mappings[0] as { targets: unknown[] }).targets = [42];
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { macroMappings: mappings } }])
            );
            expect(loadUserPatches()[0]!.patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
        });
    });

    describe('macros tuple non-array and length guards', () => {
        it('falls back when a macros tuple entry is not a number (boolean)', () => {
            const macros = [0.1, 0.2, true, 0.4, 0.5, 0.6, 0.7, 0.8];
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'r', name: 'n', patch: { macros } }]));
            expect(loadUserPatches()[0]!.patch.macros).toEqual(DEFAULT_PATCH.macros);
        });
    });

    describe('patch field non-number guard', () => {
        it('skips a stored numeric field whose value is a non-number type (string)', () => {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify([{ id: 'r', name: 'n', patch: { filterCutoff: 'bright', oscLevel: 'loud' } }])
            );
            const patch = loadUserPatches()[0]!.patch;
            expect(patch.filterCutoff).toBe(DEFAULT_PATCH.filterCutoff);
            expect(patch.oscLevel).toBe(DEFAULT_PATCH.oscLevel);
        });
    });
});
