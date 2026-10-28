import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getCanonicalTrackRoleOptions, querySemanticProject } from '#/modules/Project/useCases';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeRecipeExpansion } from '../executeRecipeExpansion';
import { executeTransformCompile } from '../executeTransformCompile';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { projectDeclarativeTransformSnapshot } from '../projectDeclarativeTransformSnapshot';

import { createTrack } from './trackFixture';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return { ...original, getMixRecipeCatalog: vi.fn(original.getMixRecipeCatalog) };
});

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../transformers/promptParser/parsing')>()),
    tryPresetMatch: vi.fn(),
    tryParameterizedPath: vi.fn(),
    tryCompoundFastPath: vi.fn(),
}));

type CanonicalRole = ReturnType<typeof getCanonicalTrackRoleOptions>[number];
type RecipeRoleName = 'vocal' | 'drums' | 'bass' | 'guitar' | 'keys' | 'bus' | 'master';

/**
 * The recipe role every canonical track role resolves to, restated here as a literal
 * expectation table independent of `CANONICAL_ROLE_TO_RECIPE_ROLE` in `canonicalRoleFamilies.ts`
 * so a silent edit to that production table fails this spec instead of both agreeing.
 * `Record<CanonicalRole, ...>` over the full role union fails typecheck if a canonical role
 * this catalog can produce is ever left out.
 */
const CANONICAL_ROLE_TO_EXPECTED_RECIPE_ROLE: Readonly<Record<CanonicalRole, RecipeRoleName | null>> = {
    kick: 'drums',
    snare: 'drums',
    'hi-hat': 'drums',
    tom: 'drums',
    cymbal: 'drums',
    percussion: 'drums',
    overhead: 'drums',
    room: 'drums',
    drums: 'drums',
    'lead vocal': 'vocal',
    'backing vocal': 'vocal',
    bass: 'bass',
    guitar: 'guitar',
    keys: 'keys',
    synth: 'keys',
    pad: 'keys',
    strings: 'keys',
    brass: 'keys',
    bus: 'bus',
    master: 'master',
    fx: null,
    utility: null,
    unknown: null,
};

/**
 * Authors `role` for `trackId` in the production brief, the real route a user takes to
 * assign a track's role — including the literal `'unknown'` role, which is a normal
 * member of the canonical role union and needs no synthetic stand-in.
 */
function authorProductionBriefRole(trackId: string, role: CanonicalRole): void {
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        productionBrief: {
            ...structuredClone(defaultProjectStoreState.productionBrief),
            trackRoles: [{ id: `role-${trackId}`, trackId, role, createdAt: 0 }],
        },
    });
}

/** One `recipe.discover` call, followed by an empty turn so the loop completes. */
async function runRecipeDiscovery(loopId: string, args: Record<string, unknown>) {
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete' as const,
            toolCalls: [{ id: 'discover-1', name: 'recipe.discover', arguments: args }],
        })
        .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [] });

    const result = await runApplicationOwnedToolLoop({
        loopId,
        terminalToolNames: new Set(['setTempo']),
        requestTurn,
    });
    if (result.status !== 'complete') {
        throw new Error(`Expected the loop to complete, got: ${result.reason}`);
    }
    const receipt = result.receipts.find((entry) => entry.callId === 'discover-1');
    if (!receipt) {
        throw new Error('recipe.discover receipt was not recorded');
    }
    return receipt;
}

describe('recipe.discover', () => {
    beforeEach(() => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] },
            revisionToken: 'revision-1',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    it('resolves "warmer" to the warm descriptor', async () => {
        const receipt = await runRecipeDiscovery('loop-warmer', { descriptors: ['warmer'] });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({ terms: [{ term: 'warmer', descriptor: 'warm' }] });
    });

    it('resolves "Less  Bright" to the dark descriptor', async () => {
        const receipt = await runRecipeDiscovery('loop-less-bright', { descriptors: ['Less  Bright'] });

        expect(receipt.data).toMatchObject({ terms: [{ term: 'less bright', descriptor: 'dark' }] });
    });

    it('resolves "lofi" to the lo-fi descriptor', async () => {
        const receipt = await runRecipeDiscovery('loop-lofi', { descriptors: ['lofi'] });

        expect(receipt.data).toMatchObject({ terms: [{ term: 'lofi', descriptor: 'lo-fi' }] });
    });

    it('resolves "fuller" to the thin descriptor', async () => {
        const receipt = await runRecipeDiscovery('loop-fuller', { descriptors: ['fuller'] });

        expect(receipt.data).toMatchObject({ terms: [{ term: 'fuller', descriptor: 'thin' }] });
    });

    it('returns zero candidates and one warning naming an unresolved term', async () => {
        const receipt = await runRecipeDiscovery('loop-shimmery', { descriptors: ['shimmery'] });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({
            terms: [{ term: 'shimmery', descriptor: null, effect: null }],
            total: 0,
            candidates: [],
        });
        expect(receipt.warnings).toHaveLength(1);
        expect(receipt.warnings[0]).toContain('shimmery');
        expect(receipt.warnings[0]).toContain('less muddy');
        expect(receipt.warnings[0]).toContain('(removes');
        expect(receipt.warnings[0]).not.toContain('Known descriptors:');
    });

    it('resolves "thin" and "less thin" to the thin descriptor with a removes effect', async () => {
        const receipt = await runRecipeDiscovery('loop-thin', { descriptors: ['thin', 'less thin'] });

        expect(receipt.data).toMatchObject({
            terms: [
                { term: 'thin', descriptor: 'thin', effect: 'removes' },
                { term: 'less thin', descriptor: 'thin', effect: 'removes' },
            ],
        });
        const data = receipt.data as { candidates: { effect: string }[] };
        expect(data.candidates.length).toBeGreaterThan(0);
        for (const candidate of data.candidates) {
            expect(candidate.effect).toBe('removes');
        }
    });

    it('resolves "brighter" to the bright descriptor with a produces effect', async () => {
        const receipt = await runRecipeDiscovery('loop-brighter', { descriptors: ['brighter'] });

        expect(receipt.data).toMatchObject({ terms: [{ term: 'brighter', descriptor: 'bright', effect: 'produces' }] });
        const data = receipt.data as { candidates: { effect: string }[] };
        expect(data.candidates.length).toBeGreaterThan(0);
        for (const candidate of data.candidates) {
            expect(candidate.effect).toBe('produces');
        }
    });

    it('resolves an untagged "Kick" track to the drums recipe role and returns only punchy/drums candidates', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'kick-1', name: 'Kick' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-kick', { descriptors: ['punchy'], targetId: 'kick-1' });

        expect(receipt.data).toMatchObject({
            role: { recipeRole: 'drums', source: 'target', canonicalRole: 'kick' },
        });
        const data = receipt.data as { candidates: { descriptor: string; roles: string[] }[] };
        expect(data.candidates.length).toBeGreaterThan(0);
        for (const candidate of data.candidates) {
            expect(candidate.descriptor).toBe('punchy');
            expect(candidate.roles).toContain('drums');
        }
    });

    it('resolves an untagged "Pad" track to the keys recipe role', async () => {
        trackStore.set({ tracks: [createTrack({ id: 'pad-1', name: 'Pad' })], selectedTrackId: null, ghostClips: [] });

        const receipt = await runRecipeDiscovery('loop-pad', { descriptors: ['punchy'], targetId: 'pad-1' });

        expect(receipt.data).toMatchObject({
            role: { recipeRole: 'keys', source: 'target', canonicalRole: 'pad' },
        });
    });

    it('resolves an untagged "Lead Vocal" track to the vocal recipe role', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-lead-vocal', {
            descriptors: ['warmer'],
            targetId: 'lead-vocal-1',
        });

        expect(receipt.data).toMatchObject({
            role: { recipeRole: 'vocal', source: 'target', canonicalRole: 'lead vocal' },
        });
    });

    it('resolves an untagged "Backing Vocal" track to the vocal recipe role', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'backing-vocal-1', name: 'Backing Vocal' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-backing-vocal', {
            descriptors: ['warmer'],
            targetId: 'backing-vocal-1',
        });

        expect(receipt.data).toMatchObject({
            role: { recipeRole: 'vocal', source: 'target', canonicalRole: 'backing vocal' },
        });
    });

    it('resolves a bus-kind track to the bus recipe role', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'bus-role-1', name: 'Drum Bus', kind: 'bus' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-bus-role', { descriptors: ['punchy'], targetId: 'bus-role-1' });

        expect(receipt.data).toMatchObject({
            role: { recipeRole: 'bus', source: 'target', canonicalRole: 'bus' },
        });
    });

    it('resolves a master-kind track to the master recipe role', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'master-role-1', name: 'Master', kind: 'master' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-master-role', {
            descriptors: ['warmer'],
            targetId: 'master-role-1',
        });

        expect(receipt.data).toMatchObject({
            role: { recipeRole: 'master', source: 'target', canonicalRole: 'master' },
        });
    });

    it.each(getCanonicalTrackRoleOptions().map((role) => [role] as const))(
        'resolves an authored "%s" canonical role to its recipe role through the tool loop',
        async (canonicalRole) => {
            if (!Object.hasOwn(CANONICAL_ROLE_TO_EXPECTED_RECIPE_ROLE, canonicalRole)) {
                throw new Error(
                    `No expected recipe role recorded for canonical role "${canonicalRole}"; add it to CANONICAL_ROLE_TO_EXPECTED_RECIPE_ROLE.`
                );
            }
            const expectedRecipeRole = CANONICAL_ROLE_TO_EXPECTED_RECIPE_ROLE[canonicalRole];
            const targetId = `role-target-${canonicalRole}`;
            trackStore.set({
                tracks: [createTrack({ id: targetId, name: 'Track' })],
                selectedTrackId: null,
                ghostClips: [],
            });
            authorProductionBriefRole(targetId, canonicalRole);

            const receipt = await runRecipeDiscovery(`loop-role-${canonicalRole}`, {
                descriptors: ['warmer'],
                targetId,
            });

            expect(receipt.status).toBe('success');
            expect(receipt.data).toMatchObject({
                role: { recipeRole: expectedRecipeRole, source: 'target', canonicalRole },
            });

            if (expectedRecipeRole === null) {
                // Matches the shape asserted by the FX Return case above: no recipe role
                // means zero candidates and a warning naming the missing recipe role.
                expect(receipt.data).toMatchObject({ total: 0, candidates: [] });
                expect(receipt.warnings.some((warning) => warning.toLowerCase().includes('recipe role'))).toBe(true);
                return;
            }

            const data = receipt.data as { total: number; candidates: { roles: string[] }[] };
            expect(data.total).toBeGreaterThan(0);
            for (const candidate of data.candidates) {
                expect(candidate.roles).toContain(expectedRecipeRole);
            }
        }
    );

    it('returns zero candidates and a no-recipe-role warning for an FX Return with no role argument', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'fx-1', name: 'FX Return' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-fx-return', { descriptors: ['warmer'], targetId: 'fx-1' });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({ total: 0, candidates: [] });
        expect(receipt.warnings.some((warning) => warning.toLowerCase().includes('recipe role'))).toBe(true);
    });

    it('lets a role argument override an FX Return target and filters candidates to that role', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'fx-1', name: 'FX Return' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-fx-return-role', {
            descriptors: ['warmer'],
            targetId: 'fx-1',
            role: 'vocal',
        });

        expect(receipt.data).toMatchObject({ role: { recipeRole: 'vocal', source: 'argument' } });
        const data = receipt.data as { candidates: { roles: string[] }[] };
        expect(data.candidates.length).toBeGreaterThan(0);
        for (const candidate of data.candidates) {
            expect(candidate.roles).toContain('vocal');
        }
    });

    it('excludes a bus recipe whose edit step needs a compressor the bus does not have', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-bus-no-compressor', {
            descriptors: ['punchy'],
            targetId: 'bus-1',
        });

        const data = receipt.data as { excludedForChain: number; candidates: { id: string }[] };
        expect(data.candidates.some((candidate) => candidate.id === 'bus-punchy')).toBe(false);
        expect(data.excludedForChain).toBeGreaterThanOrEqual(1);
    });

    it('includes bus-punchy with its existing compressor id once the bus already carries one', async () => {
        trackStore.set({
            tracks: [
                createTrack({
                    id: 'bus-2',
                    name: 'Drum Bus',
                    kind: 'bus',
                    devices: [
                        {
                            id: 'device-comp-1',
                            name: 'Compressor',
                            type: 'builtin-compressor',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-bus-with-compressor', {
            descriptors: ['punchy'],
            targetId: 'bus-2',
        });

        const data = receipt.data as {
            candidates: {
                id: string;
                steps: { deviceType: string; existingDevices: { id: string; bypassed: boolean }[] }[];
            }[];
        };
        const busPunchy = data.candidates.find((candidate) => candidate.id === 'bus-punchy');
        expect(busPunchy).toBeDefined();
        const editStep = busPunchy?.steps.find((step) => step.deviceType === 'builtin-compressor');
        expect(editStep?.existingDevices).toEqual([{ id: 'device-comp-1', bypassed: false }]);
    });

    it('reports the bus-punchy compressor as bypassed when the bus only carries it bypassed', async () => {
        trackStore.set({
            tracks: [
                createTrack({
                    id: 'bus-3',
                    name: 'Drum Bus',
                    kind: 'bus',
                    devices: [
                        {
                            id: 'device-comp-2',
                            name: 'Compressor',
                            type: 'builtin-compressor',
                            bypassed: true,
                            parameterValues: {},
                        },
                    ],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-bus-bypassed-compressor', {
            descriptors: ['punchy'],
            targetId: 'bus-3',
        });

        const data = receipt.data as {
            candidates: {
                id: string;
                steps: { deviceType: string; existingDevices: { id: string; bypassed: boolean }[] }[];
            }[];
        };
        const busPunchy = data.candidates.find((candidate) => candidate.id === 'bus-punchy');
        expect(busPunchy).toBeDefined();
        const editStep = busPunchy?.steps.find((step) => step.deviceType === 'builtin-compressor');
        expect(editStep?.existingDevices).toEqual([{ id: 'device-comp-2', bypassed: true }]);
    });

    it('warns that device changes are refused while the target is frozen', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'bus-frozen', name: 'Drum Bus', kind: 'bus', frozen: true })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-frozen', { descriptors: ['punchy'], targetId: 'bus-frozen' });

        expect(receipt.status).toBe('success');
        expect(receipt.warnings.some((warning) => warning.toLowerCase().includes('frozen'))).toBe(true);
    });

    it('returns zero candidates and a non-audio-processing warning for a folder target', async () => {
        trackStore.set({
            tracks: [
                createTrack({ id: 'folder-drums', name: 'Drums', kind: 'folder' }),
                createTrack({ id: 'kick-1', name: 'Kick', parentId: 'folder-drums' }),
                createTrack({ id: 'snare-1', name: 'Snare', parentId: 'folder-drums' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-folder-target', {
            descriptors: ['punchy'],
            targetId: 'folder-drums',
        });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({ total: 0, candidates: [] });
        expect(receipt.warnings).toHaveLength(1);
        expect(receipt.warnings[0]?.toLowerCase()).toContain('folder');
        expect(receipt.warnings[0]?.toLowerCase()).toContain('does not process');
    });

    it('still returns candidates for a bus target named Drums, unlike a folder (control)', async () => {
        trackStore.set({
            tracks: [
                createTrack({
                    id: 'bus-control',
                    name: 'Drums',
                    kind: 'bus',
                    devices: [
                        {
                            id: 'device-comp-1',
                            name: 'Compressor',
                            type: 'builtin-compressor',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-bus-control', {
            descriptors: ['punchy'],
            targetId: 'bus-control',
        });

        expect(receipt.status).toBe('success');
        const data = receipt.data as { total: number; candidates: { id: string }[] };
        expect(data.total).toBeGreaterThan(0);
        expect(data.candidates.some((candidate) => candidate.id === 'bus-punchy')).toBe(true);
        expect(receipt.warnings).toHaveLength(0);
    });

    it('fails with invalid-tool-arguments for an unknown targetId', async () => {
        const receipt = await runRecipeDiscovery('loop-unknown-target', {
            descriptors: ['warmer'],
            targetId: 'does-not-exist',
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.code).toBe('invalid-tool-arguments');
    });

    it('bounds a wide match to the requested limit and keeps the receipt under the byte budget', async () => {
        const receipt = await runRecipeDiscovery('loop-limit', {
            descriptors: ['warm', 'brighter', 'tighten', 'more punch'],
            limit: 8,
        });

        const data = receipt.data as { total: number; candidates: unknown[] };
        expect(data.candidates).toHaveLength(8);
        expect(data.total).toBeGreaterThan(8);
        expect(new TextEncoder().encode(JSON.stringify(receipt)).byteLength).toBeLessThan(16_384);
    });

    it.each([
        ['an unknown key', { descriptors: ['warmer'], extra: true }],
        ['too many descriptors', { descriptors: ['warm', 'bright', 'tight', 'punchy', 'wide'] }],
        ['a limit above the maximum', { descriptors: ['warmer'], limit: 9 }],
        ['a role outside the catalog', { descriptors: ['warmer'], role: 'choir' }],
    ])('fails with invalid-tool-arguments for %s', async (_label, args) => {
        const receipt = await runRecipeDiscovery('loop-invalid', args);

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.code).toBe('invalid-tool-arguments');
    });
});

const EXPANSION_REVISION = 'revision-recipe-expand';

type ExpansionCall = { id: string; name: string; arguments: Record<string, unknown> };
type ExpandedCommand = { name: string; arguments: Record<string, unknown> };
type ExpandedValue = {
    step: number;
    paramId: string;
    value: number;
    minimum: number;
    maximum: number;
    source: string;
};
type ExpansionData = {
    recipeId: string;
    title: string;
    targetId: string;
    commands: ExpandedCommand[];
    values: ExpandedValue[];
};

function installedDevice(id: string, type: string, bypassed = false): Track['devices'][number] {
    return { id, name: type, type, bypassed, parameterValues: {} };
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
}

/** The recipe-expansion binding a run gets, reading the project the way the planner does. */
function recipeExpansionTool(): NonNullable<Parameters<typeof runApplicationOwnedToolLoop>[0]['recipe']> {
    return {
        toolName: 'recipe.expand',
        revision: EXPANSION_REVISION,
        execute: (call: ToolCallResult, context) =>
            executeRecipeExpansion({
                call,
                callId: context.callId,
                turn: context.turn,
                ordinal: context.ordinal,
                context: getProjectContext(),
                revision: EXPANSION_REVISION,
            }),
    };
}

/** One `recipe.expand` call, followed by an empty turn so the loop completes. */
async function runRecipeExpansion(loopId: string, args: Record<string, unknown>): Promise<ApplicationToolReceipt> {
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete' as const,
            toolCalls: [{ id: 'expand-1', name: 'recipe.expand', arguments: args }],
        })
        .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [] });

    const result = await runApplicationOwnedToolLoop({
        loopId,
        terminalToolNames: new Set(['setTempo']),
        requestTurn,
        recipe: recipeExpansionTool(),
    });
    if (result.status !== 'complete') {
        throw new Error(`Expected the loop to complete, got: ${result.reason}`);
    }
    const receipt = result.receipts.find((entry) => entry.callId === 'expand-1');
    if (!receipt) {
        throw new Error('recipe.expand receipt was not recorded');
    }
    return receipt;
}

function readExpansion(receipt: ApplicationToolReceipt): ExpansionData {
    expect(receipt.status).toBe('success');
    return receipt.data as ExpansionData;
}

describe('recipe.expand', () => {
    beforeEach(() => {
        setTracks([]);
    });

    afterEach(() => {
        vi.mocked(getMixRecipeCatalog).mockRestore();
        setTracks([]);
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    // Red when the second insert stops chaining after the first binding, the first insert stops following
    // the chain's last device, or an omitted value stops taking the middle of its window.
    it('expands a two-insert recipe on a vocal track into chained addDevice and midpoint setDeviceParameter items', async () => {
        setTracks([
            createTrack({
                id: 'lead-vocal-1',
                name: 'Lead Vocal',
                devices: [installedDevice('device-existing-1', 'builtin-limiter')],
            }),
        ]);

        const receipt = await runRecipeExpansion('loop-expand-two-inserts', {
            recipeId: 'vocal-bright',
            targetId: 'lead-vocal-1',
        });

        const data = readExpansion(receipt);
        expect(data).toMatchObject({ recipeId: 'vocal-bright', targetId: 'lead-vocal-1' });
        expect(data.title).toBe(getMixRecipeCatalog().recipes.find((recipe) => recipe.id === 'vocal-bright')?.title);
        expect(data.commands).toEqual([
            {
                name: 'addDevice',
                arguments: {
                    trackId: 'lead-vocal-1',
                    deviceType: 'builtin-eq',
                    afterDeviceId: 'device-existing-1',
                    binding: 'recipe-1-0',
                },
            },
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: '$recipe-1-0', paramId: 'eq-high-freq', value: 9500 },
            },
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: '$recipe-1-0', paramId: 'eq-high-gain', value: 3.25 },
            },
            {
                name: 'addDevice',
                arguments: {
                    trackId: 'lead-vocal-1',
                    deviceType: 'builtin-deesser',
                    afterDeviceId: '$recipe-1-0',
                    binding: 'recipe-1-1',
                },
            },
            { name: 'setDeviceParameter', arguments: { deviceId: '$recipe-1-1', paramId: 'deess-freq', value: 6750 } },
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: '$recipe-1-1', paramId: 'deess-threshold', value: -21 },
            },
            { name: 'setDeviceParameter', arguments: { deviceId: '$recipe-1-1', paramId: 'deess-range', value: -8 } },
        ]);
        expect(data.values).toEqual([
            { step: 0, paramId: 'eq-high-freq', value: 9500, minimum: 8000, maximum: 11000, source: 'midpoint' },
            { step: 0, paramId: 'eq-high-gain', value: 3.25, minimum: 2, maximum: 4.5, source: 'midpoint' },
            { step: 1, paramId: 'deess-freq', value: 6750, minimum: 6000, maximum: 7500, source: 'midpoint' },
            { step: 1, paramId: 'deess-threshold', value: -21, minimum: -24, maximum: -18, source: 'midpoint' },
            { step: 1, paramId: 'deess-range', value: -8, minimum: -10, maximum: -6, source: 'midpoint' },
        ]);
    });

    it('starts the first insert without an anchor when the chain is empty', async () => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const data = readExpansion(
            await runRecipeExpansion('loop-expand-empty-chain', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' })
        );

        expect(data.commands[0]).toEqual({
            name: 'addDevice',
            arguments: { trackId: 'lead-vocal-1', deviceType: 'builtin-eq', binding: 'recipe-1-0' },
        });
    });

    // Red when a supplied value is ignored in favour of the midpoint, or reported as a midpoint.
    it('uses a supplied value that lies inside its window and keeps the midpoint for the rest', async () => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const data = readExpansion(
            await runRecipeExpansion('loop-expand-supplied', {
                recipeId: 'vocal-bright',
                targetId: 'lead-vocal-1',
                values: [{ step: 0, paramId: 'eq-high-gain', value: 4 }],
            })
        );

        expect(data.values.find((entry) => entry.paramId === 'eq-high-gain')).toEqual({
            step: 0,
            paramId: 'eq-high-gain',
            value: 4,
            minimum: 2,
            maximum: 4.5,
            source: 'supplied',
        });
        expect(data.commands[2]).toEqual({
            name: 'setDeviceParameter',
            arguments: { deviceId: '$recipe-1-0', paramId: 'eq-high-gain', value: 4 },
        });
        expect(data.values.find((entry) => entry.paramId === 'eq-high-freq')).toMatchObject({
            value: 9500,
            source: 'midpoint',
        });
    });

    // Red when a value outside its window is accepted, or the refusal stops naming the window.
    it.each([
        ['above', 9],
        ['below', 1.99],
    ])('refuses a supplied value %s its window and names the window', async (_side, value) => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const receipt = await runRecipeExpansion('loop-expand-outside-window', {
            recipeId: 'vocal-bright',
            targetId: 'lead-vocal-1',
            values: [{ step: 0, paramId: 'eq-high-gain', value }],
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.code).toBe('invalid-tool-arguments');
        expect(receipt.error?.safeMessage).toContain('eq-high-gain');
        expect(receipt.error?.safeMessage).toContain('2 to 4.5');
    });

    it.each([
        ['a step the recipe lacks', { step: 2, paramId: 'eq-high-gain', value: 3 }, 'step 2'],
        ['a parameter the step lacks', { step: 0, paramId: 'deess-freq', value: 6500 }, 'deess-freq'],
    ])('refuses a value naming %s', async (_label, entry, mention) => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const receipt = await runRecipeExpansion('loop-expand-unknown-value', {
            recipeId: 'vocal-bright',
            targetId: 'lead-vocal-1',
            values: [entry],
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.safeMessage).toContain(mention);
    });

    // Red when the edit step stops retuning the one existing device, or when no device or an ambiguous one
    // is no longer refused.
    it('retunes the one existing device an edit step names without inserting another', async () => {
        setTracks([
            createTrack({
                id: 'drum-bus-1',
                name: 'Drum Bus',
                kind: 'bus',
                devices: [
                    installedDevice('device-comp-bypassed', 'builtin-compressor', true),
                    installedDevice('device-comp-live', 'builtin-compressor'),
                ],
            }),
        ]);

        const data = readExpansion(
            await runRecipeExpansion('loop-expand-edit', { recipeId: 'bus-punchy', targetId: 'drum-bus-1' })
        );

        expect(data.commands.map((command) => command.name)).toEqual([
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
        ]);
        expect(data.commands.map((command) => command.arguments.deviceId)).toEqual([
            'device-comp-live',
            'device-comp-live',
            'device-comp-live',
            'device-comp-live',
        ]);
        expect(data.values.find((entry) => entry.paramId === 'comp-ratio')).toMatchObject({ value: 3 });
    });

    it.each([
        ['no device of the type', []],
        ['only a bypassed device of the type', [installedDevice('device-comp-bypassed', 'builtin-compressor', true)]],
    ])('refuses an edit step when the target has %s', async (_label, devices) => {
        setTracks([createTrack({ id: 'drum-bus-1', name: 'Drum Bus', kind: 'bus', devices })]);

        const receipt = await runRecipeExpansion('loop-expand-edit-missing', {
            recipeId: 'bus-punchy',
            targetId: 'drum-bus-1',
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.code).toBe('invalid-tool-arguments');
        expect(receipt.error?.safeMessage).toContain('no non-bypassed builtin-compressor');
    });

    it('refuses an edit step as ambiguous and names every candidate device', async () => {
        setTracks([
            createTrack({
                id: 'drum-bus-1',
                name: 'Drum Bus',
                kind: 'bus',
                devices: [
                    installedDevice('device-comp-a', 'builtin-compressor'),
                    installedDevice('device-comp-b', 'builtin-compressor'),
                ],
            }),
        ]);

        const receipt = await runRecipeExpansion('loop-expand-edit-ambiguous', {
            recipeId: 'bus-punchy',
            targetId: 'drum-bus-1',
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.safeMessage).toContain('ambiguous');
        expect(receipt.error?.safeMessage).toContain('device-comp-a');
        expect(receipt.error?.safeMessage).toContain('device-comp-b');
    });

    // Red when a discrete parameter's midpoint stops snapping onto one of its legal settings.
    it('snaps the midpoint of a discrete parameter onto a legal setting', async () => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const data = readExpansion(
            await runRecipeExpansion('loop-expand-discrete', { recipeId: 'vocal-lo-fi', targetId: 'lead-vocal-1' })
        );

        const bits = data.values.find((entry) => entry.paramId === 'crush-bits');
        expect(bits).toMatchObject({ minimum: 5, maximum: 8 });
        expect(Number.isInteger(bits?.value)).toBe(true);
        expect(bits?.value).toBe(7);
        expect(data.values.find((entry) => entry.paramId === 'crush-mix')?.value).toBe(0.45);
    });

    // Red when any of these targets or recipes is accepted instead of refused.
    it.each([
        ['an unknown recipe id', { recipeId: 'no-such-recipe', targetId: 'lead-vocal-1' }, 'no-such-recipe'],
        ['an unknown target', { recipeId: 'vocal-warm', targetId: 'no-such-track' }, 'no-such-track'],
        ['a folder target', { recipeId: 'vocal-warm', targetId: 'folder-1' }, 'folder'],
        ['a frozen target', { recipeId: 'vocal-warm', targetId: 'frozen-vocal-1' }, 'frozen'],
        ['a target whose role the recipe was not authored for', { recipeId: 'vocal-warm', targetId: 'bass-1' }, 'bass'],
        ['a target with no recipe role and no role argument', { recipeId: 'vocal-warm', targetId: 'fx-1' }, 'role'],
    ])('refuses %s', async (_label, args, mention) => {
        setTracks([
            createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' }),
            createTrack({ id: 'folder-1', name: 'Vocals', kind: 'folder' }),
            createTrack({ id: 'frozen-vocal-1', name: 'Backing Vocal', frozen: true }),
            createTrack({ id: 'bass-1', name: 'Bass' }),
            createTrack({ id: 'fx-1', name: 'FX Return' }),
        ]);

        const receipt = await runRecipeExpansion('loop-expand-refused', args);

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.code).toBe('invalid-tool-arguments');
        expect(receipt.error?.safeMessage).toContain(mention);
    });

    it('lets an explicit role argument stand in for the target role, as recipe.discover resolves it', async () => {
        setTracks([createTrack({ id: 'fx-1', name: 'FX Return' }), createTrack({ id: 'bass-1', name: 'Bass' })]);

        const onFx = readExpansion(
            await runRecipeExpansion('loop-expand-role-fx', {
                recipeId: 'vocal-warm',
                targetId: 'fx-1',
                role: 'vocal',
            })
        );
        const onBass = readExpansion(
            await runRecipeExpansion('loop-expand-role-bass', {
                recipeId: 'vocal-warm',
                targetId: 'bass-1',
                role: 'vocal',
            })
        );

        expect(onFx.commands[0]?.arguments).toMatchObject({ trackId: 'fx-1', deviceType: 'builtin-eq' });
        expect(onBass.commands[0]?.arguments).toMatchObject({ trackId: 'bass-1', deviceType: 'builtin-eq' });
    });

    it('refuses a recipe whose role the explicit role argument excludes', async () => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const receipt = await runRecipeExpansion('loop-expand-role-mismatch', {
            recipeId: 'vocal-warm',
            targetId: 'lead-vocal-1',
            role: 'bass',
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.safeMessage).toContain('authored for vocal');
    });

    it.each([
        ['an unknown key', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1', extra: true }],
        ['a missing target', { recipeId: 'vocal-warm' }],
        ['a role outside the catalog', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1', role: 'choir' }],
        [
            'a value entry with an unknown key',
            { recipeId: 'vocal-warm', targetId: 'lead-vocal-1', values: [{ step: 0, paramId: 'a', value: 1, x: 1 }] },
        ],
        [
            'a repeated step and parameter',
            {
                recipeId: 'vocal-warm',
                targetId: 'lead-vocal-1',
                values: [
                    { step: 0, paramId: 'eq-low-gain', value: 2 },
                    { step: 0, paramId: 'eq-low-gain', value: 2.5 },
                ],
            },
        ],
        [
            'more values than a recipe has commands',
            {
                recipeId: 'vocal-warm',
                targetId: 'lead-vocal-1',
                values: Array.from({ length: 17 }, (_unused, index) => ({ step: 0, paramId: `p-${index}`, value: 1 })),
            },
        ],
        [
            'a non-finite value',
            { recipeId: 'vocal-warm', targetId: 'lead-vocal-1', values: [{ step: 0, paramId: 'a', value: 'high' }] },
        ],
    ])('fails with invalid-tool-arguments for %s', async (_label, args) => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const receipt = await runRecipeExpansion('loop-expand-invalid', args);

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.code).toBe('invalid-tool-arguments');
    });

    // Red when an expansion above the command ceiling is accepted instead of refused with its counts.
    it('refuses an expansion above the command ceiling with the counts', async () => {
        const catalog = getMixRecipeCatalog();
        const oversized = {
            ...catalog.recipes.find((recipe) => recipe.id === 'vocal-warm')!,
            id: 'vocal-oversized',
            steps: [
                {
                    kind: 'insert' as const,
                    deviceType: 'builtin-eq',
                    parameters: Array.from({ length: 17 }, (_unused, index) => ({
                        paramId: `eq-low-gain-${index}`,
                        minimum: 1,
                        maximum: 2,
                    })),
                },
            ],
        };
        vi.mocked(getMixRecipeCatalog).mockReturnValue({ ...catalog, recipes: [oversized] });
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const receipt = await runRecipeExpansion('loop-expand-oversized', {
            recipeId: 'vocal-oversized',
            targetId: 'lead-vocal-1',
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.safeMessage).toContain('18 commands');
        expect(receipt.error?.safeMessage).toContain('16');
    });

    // Red when a midpoint snapped outside its window is emitted instead of refused.
    it('refuses a discrete parameter whose window holds no legal setting', async () => {
        const catalog = getMixRecipeCatalog();
        const base = catalog.recipes.find((recipe) => recipe.id === 'vocal-lo-fi')!;
        const narrow = {
            ...base,
            id: 'vocal-narrow-bits',
            steps: [
                {
                    kind: 'insert' as const,
                    deviceType: 'builtin-bitcrusher',
                    parameters: [{ paramId: 'crush-bits', minimum: 1.2, maximum: 1.4 }],
                },
            ],
        };
        vi.mocked(getMixRecipeCatalog).mockReturnValue({ ...catalog, recipes: [narrow] });
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const receipt = await runRecipeExpansion('loop-expand-no-legal-setting', {
            recipeId: 'vocal-narrow-bits',
            targetId: 'lead-vocal-1',
        });

        expect(receipt.status).toBe('failure');
        expect(receipt.error?.safeMessage).toContain('no legal setting');
    });

    // Red when any authored recipe stops expanding inside its windows and the loop's per-call receipt budget.
    it('expands every authored recipe inside its windows and the per-call receipt budget', async () => {
        const failures: string[] = [];
        // Preset recipes are not authored here; presetRecipes.spec.ts owns their expansion.
        for (const recipe of getMixRecipeCatalog().recipes.filter((candidate) => candidate.origin === undefined)) {
            const role = recipe.roles[0]!;
            const editedTypes = recipe.steps.filter((step) => step.kind === 'edit').map((step) => step.deviceType);
            setTracks([
                createTrack({
                    id: 'target-1',
                    name: 'Target',
                    devices: editedTypes.map((type, index) => installedDevice(`device-${index}`, type)),
                }),
            ]);

            const receipt = await runRecipeExpansion(`loop-expand-${recipe.id}`, {
                recipeId: recipe.id,
                targetId: 'target-1',
                role,
            });

            if (receipt.status !== 'success') {
                failures.push(`${recipe.id}: ${receipt.summary}`);
                continue;
            }
            const data = receipt.data as ExpansionData;
            const outside = data.values.filter((entry) => entry.value < entry.minimum || entry.value > entry.maximum);
            if (outside.length > 0) {
                failures.push(`${recipe.id}: ${outside.map((entry) => entry.paramId).join(', ')} outside window`);
            }
        }

        expect(failures).toEqual([]);
    });

    it('keeps recipe.expand unavailable to a run with no revision-bound read model', async () => {
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-expand-unbound',
            terminalToolNames: new Set(['setTempo']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete' as const,
                toolCalls: [
                    {
                        id: 'expand-1',
                        name: 'recipe.expand',
                        arguments: { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' },
                    },
                ],
            }),
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
        });
    });
});

describe('recipe.expand adoption by command.batch.propose', () => {
    const proposalTool = new Set(['command.batch.propose', 'command.batch.decline']);

    function loopWith(
        turns: ReadonlyArray<ExpansionCall[]>,
        overrides: { limits?: { maxReceiptBytesPerCall: number } } = {}
    ) {
        const requestTurn = vi.fn();
        for (const toolCalls of turns) {
            requestTurn.mockResolvedValueOnce({ status: 'complete' as const, toolCalls });
        }
        return runApplicationOwnedToolLoop({
            loopId: 'loop-adopt',
            terminalToolNames: proposalTool,
            requestTurn,
            recipe: recipeExpansionTool(),
            ...overrides,
        });
    }

    const expand = (id: string, args: Record<string, unknown>): ExpansionCall => ({
        id,
        name: 'recipe.expand',
        arguments: args,
    });

    const propose = (compiledCallIds: string[]): ExpansionCall => ({
        id: 'propose-1',
        name: 'command.batch.propose',
        arguments: { commands: [], compiledCallIds },
    });

    beforeEach(() => {
        setTracks([
            createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' }),
            createTrack({ id: 'backing-vocal-1', name: 'Backing Vocal' }),
        ]);
    });

    afterEach(() => {
        setTracks([]);
    });

    // Red when the loop stops retaining a successful expansion by call id as a recipe.
    it('retains two expansions in one run as recipe compilations with distinct device bindings', async () => {
        const result = await loopWith([
            [
                expand('expand-1', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' }),
                expand('expand-2', { recipeId: 'vocal-warm', targetId: 'backing-vocal-1' }),
            ],
            [propose(['expand-1', 'expand-2'])],
        ]);

        if (result.status !== 'complete') {
            throw new Error(`Expected the loop to complete, got: ${result.reason}`);
        }
        expect(result.retainedCompilations.map((entry) => entry.kind)).toEqual(['recipe', 'recipe']);
        const bindings = result.retainedCompilations.flatMap((entry) =>
            entry.commands.flatMap((command) => (command.binding === null ? [] : [command.binding]))
        );
        expect(bindings).toEqual(['recipe-1-0', 'recipe-2-0']);
    });

    // Red when the reference list stops naming both kinds, or a kind loses its own retained shape.
    it('adopts a transform compilation and a recipe expansion through one reference list', async () => {
        const muteDocument = {
            schemaVersion: 1,
            name: 'mute-backing',
            seed: 1,
            variables: {},
            selectors: {},
            steps: [
                {
                    id: 'mute-backing',
                    kind: 'emit',
                    operation: 'muteTrack',
                    arguments: { trackId: { literal: 'backing-vocal-1' }, muted: { literal: true } },
                },
            ],
            assertions: [],
        };
        const snapshot = projectDeclarativeTransformSnapshot(getProjectContext(), EXPANSION_REVISION);
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete' as const,
                toolCalls: [
                    {
                        id: 'compile-1',
                        name: 'transform.compile',
                        arguments: { document: JSON.stringify(muteDocument) },
                    },
                    expand('expand-1', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' }),
                ],
            })
            .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [propose(['expand-1', 'compile-1'])] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-adopt-both',
            terminalToolNames: proposalTool,
            requestTurn,
            recipe: recipeExpansionTool(),
            transform: {
                toolName: 'transform.compile',
                revision: EXPANSION_REVISION,
                execute: (call, context) =>
                    executeTransformCompile({ call, callId: context.callId, turn: context.turn, snapshot }),
            },
        });

        if (result.status !== 'complete') {
            throw new Error(`Expected the loop to complete, got: ${result.reason}`);
        }
        expect(result.retainedCompilations.map((entry) => `${entry.kind}:${entry.callId}`)).toEqual([
            'transform:compile-1',
            'recipe:expand-1',
        ]);
    });

    it.each([
        ['an expansion the loop never ran', ['never-ran']],
        ['the same expansion twice', ['expand-1', 'expand-1']],
    ])('refuses a proposal adopting %s', async (_label, ids) => {
        const result = await loopWith([
            [expand('expand-1', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' })],
            [propose(ids)],
        ]);

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toContain('unknown, duplicate, or failed transform compilation or recipe expansion');
        }
    });

    it('refuses a proposal adopting an expansion that was refused', async () => {
        const result = await loopWith([
            [expand('expand-1', { recipeId: 'no-such-recipe', targetId: 'lead-vocal-1' })],
            [propose(['expand-1'])],
        ]);

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toContain('unknown, duplicate, or failed');
            expect(result.receipts[0]?.status).toBe('failure');
        }
    });

    it('does not retain an expansion whose receipt exceeded the per-call budget', async () => {
        const result = await loopWith(
            [[expand('expand-1', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' })], [propose(['expand-1'])]],
            { limits: { maxReceiptBytesPerCall: 256 } }
        );

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toContain('unknown, duplicate, or failed');
            expect(result.receipts[0]?.status).toBe('failure');
        }
    });

    // Red when the loop compares an expansion's revision with the transform compiler's instead of its own.
    it('refuses an expansion bound to a revision other than the run recipe revision', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete' as const,
                toolCalls: [expand('expand-1', { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' })],
            })
            .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [propose(['expand-1'])] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-adopt-stale',
            terminalToolNames: proposalTool,
            requestTurn,
            recipe: { ...recipeExpansionTool(), revision: 'revision-moved-on' },
        });

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toContain('stale transform compilation or recipe expansion');
        }
    });

    it('keeps the combined command ceiling over expansions and proposal items together', async () => {
        const result = await loopWith([
            [
                expand('expand-1', { recipeId: 'vocal-tight', targetId: 'lead-vocal-1' }),
                expand('expand-2', { recipeId: 'vocal-tight', targetId: 'backing-vocal-1' }),
            ],
            [
                {
                    id: 'propose-1',
                    name: 'command.batch.propose',
                    arguments: {
                        commands: Array.from({ length: 20 }, () => ({ name: 'setTempo', arguments: { bpm: 100 } })),
                        compiledCallIds: ['expand-1', 'expand-2'],
                    },
                },
            ],
        ]);

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toBe('Provider command proposal exceeds the command budget.');
        }
    });
});

describe('recipe.expand through provider planning', () => {
    const REVISION = 'revision-recipe-planning';
    const PROMPT = 'make the lead vocal warmer';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal' })]);
    });

    afterEach(() => {
        setTracks([]);
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    // Red when an adopted expansion stops carrying its commands into the batch or its recipe onto the result.
    it('adopts an expansion by call id into the batch and records the recipe on the planned result', async () => {
        const context = getProjectContext();
        const catalog = prepareCreativeInterpretationCatalog({ prompt: PROMPT, context, projectRevision: REVISION });
        const recipe = getMixRecipeCatalog().recipes.find((candidate) => candidate.id === 'vocal-warm');
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'interpretation-1',
                        name: 'selectCreativeInterpretation',
                        arguments: {
                            catalogId: catalog.catalogId,
                            modeId: 'edit',
                            targetCandidateIds: ['target-1'],
                            editDimensionCandidateIds: ['dimension-processing'],
                            constraintCandidateIds: [],
                            creationSlotIds: [
                                catalog.creationSlots.find((slot) => slot.objectType === 'device')?.candidateId ?? '',
                            ],
                            uncertainty: 'none',
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-1',
                        name: 'recipe.discover',
                        arguments: { descriptors: ['warmer'], targetId: 'lead-vocal-1' },
                    },
                    {
                        id: 'expand-1',
                        name: 'recipe.expand',
                        arguments: { recipeId: 'vocal-warm', targetId: 'lead-vocal-1' },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: { commands: [], compiledCallIds: ['expand-1'] },
                    },
                ],
            });

        const planned = await parsePromptToActions({ prompt: PROMPT, context, projectRevision: REVISION });

        expect(planned.rejectionReason).toBeUndefined();
        expect(planned.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'lead-vocal-1', deviceType: 'builtin-eq' } },
            { type: 'setDeviceParameter', payload: { paramId: 'eq-low-freq', value: 160 } },
            { type: 'setDeviceParameter', payload: { paramId: 'eq-low-gain', value: 2.25 } },
            { type: 'setDeviceParameter', payload: { paramId: 'eq-high-freq', value: 10_500 } },
            { type: 'setDeviceParameter', payload: { paramId: 'eq-high-gain', value: -1.5 } },
        ]);
        expect(planned.adoptedRecipes).toEqual([
            { recipeId: 'vocal-warm', title: recipe?.title, targetId: 'lead-vocal-1' },
        ]);
    });

    it('records no recipe on a batch that adopted none', async () => {
        const context = getProjectContext();
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 100 } }] },
                    },
                ],
            });

        const planned = await parsePromptToActions({
            prompt: 'set the tempo to 100',
            context,
            projectRevision: REVISION,
        });

        expect(planned.rejectionReason).toBeUndefined();
        expect(planned.actions).toMatchObject([{ type: 'setTempo', payload: { bpm: 100 } }]);
        expect(planned.adoptedRecipes).toBeUndefined();
    });
});
