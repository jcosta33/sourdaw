import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { querySemanticProject } from '#/modules/Project/useCases';

import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

function createTrack(overrides: Partial<Track>): Track {
    return {
        id: 't1',
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
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

    it('returns zero candidates and a non-audio-processing warning for a VCA target', async () => {
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'vca-drums', name: 'Drums' }),
                    // VCA is a dormant track kind: deviceStrategy.ts already refuses device
                    // adds for it, but the compile-time TrackKind union does not carry it yet
                    // (see VcaTrackMigration.ts). This fixture needs the same runtime value
                    // production code already defends against, so the field is narrowed through
                    // `unknown` rather than widening TrackKind itself.
                    kind: 'vca' as unknown as Track['kind'],
                },
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        const receipt = await runRecipeDiscovery('loop-vca-target', {
            descriptors: ['punchy'],
            targetId: 'vca-drums',
        });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({ total: 0, candidates: [] });
        expect(receipt.warnings).toHaveLength(1);
        expect(receipt.warnings[0]?.toLowerCase()).toContain('vca');
        expect(receipt.warnings[0]?.toLowerCase()).toContain('does not process');
    });

    it('still returns candidates for a bus target named Drums, unlike a folder or VCA (control)', async () => {
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
