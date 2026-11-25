import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { createCrdtProject, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { projectPianoRollTakeNotes, setMidiStoreState, setPianoRollSelection } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { captureMusicalContentBinding, querySemanticProject } from '#/modules/Project/useCases';

import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { buildAgentContext } from '../buildAgentContext';
import { getProjectContext } from '../getProjectContext';

registerDeviceEnginePorts();

describe('canonical roles at the provider continuation boundary', () => {
    let database: ReturnType<typeof installTransactionalIndexedDb>;
    beforeEach(async () => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        database = installTransactionalIndexedDb();
        await createCrdtProject('Canonical query');
        const track = createTrack({ id: 't', name: 'Track 1', kind: 'midi' });
        track.devices = [
            { id: 'd', type: 'builtin-drum-kit', name: 'Kit', bypassed: true, parameterValues: { kit: 0 } },
        ];
        track.clips = [
            {
                id: 'c',
                trackId: 't',
                name: 'Clip',
                type: 'midi',
                startBeat: 0,
                endBeat: 4,
                muted: true,
                locked: false,
                color: '',
                gain: 1,
                fadeInBeats: 0,
                fadeOutBeats: 0,
            },
        ];
        setTrackStoreState({ ...structuredClone(defaultTrackState), tracks: [track], selectedTrackId: 't' });
        setMidiStoreState({
            ...structuredClone(defaultMidiStoreState),
            notesByClipId: { c: [{ id: 'n', pitch: 36, startBeat: 0, duration: 1, velocity: 0, probability: 0 }] },
        });
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        });
    });
    afterEach(async () => {
        takeLaneStore.set({ lanes: [] });
        await database.dispose();
        vi.unstubAllGlobals();
    });

    it('binds a model musical query to the captured owner selection and returns its real receipt on the next turn', async () => {
        const clip = { id: 'c', startBeat: 0, endBeat: 4 };
        const projection = projectPianoRollTakeNotes(clip, 't', null, midiStore.value?.notesByClipId.c ?? []);
        setPianoRollSelection('c', ['n'], ['c'], [{ clipId: 'c', projection }]);
        const musicalContentBinding = captureMusicalContentBinding();
        const requestTurn = vi.fn(async ({ turn, receiptContext }: { turn: number; receiptContext: string | null }) => {
            if (turn === 1) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: 'notes',
                            name: 'project.query',
                            arguments: {
                                type: 'musical-content',
                                filters: { stableId: 'c', startBeat: 0, endBeat: 4 },
                                page: { limit: 10 },
                            },
                        },
                    ],
                };
            }
            expect(receiptContext).toContain('"pitch":36');
            expect(receiptContext).toContain('"stored-score"');
            return { status: 'complete' as const, toolCalls: [] };
        });
        const result = await runApplicationOwnedToolLoop({
            loopId: 'musical-query',
            musicalContentBinding,
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });
        expect(result.status).toBe('complete');
        expect(result.receipts[0]).toMatchObject({ status: 'success', toolName: 'project.query' });
    });

    it('sends two contrasting equal-count phrase receipts that differ in pitch and velocity to the next provider turn', async () => {
        const state = structuredClone(trackStore.value!);
        const [source] = state.tracks[0]!.clips;
        state.tracks[0]!.clips = ['phrase-a', 'phrase-b'].map((id) => ({ ...source!, id }));
        setTrackStoreState(state);
        setMidiStoreState({
            ...structuredClone(defaultMidiStoreState),
            notesByClipId: {
                'phrase-a': [
                    { id: 'a1', pitch: 60, startBeat: 0, duration: 1, velocity: 40 },
                    { id: 'a2', pitch: 62, startBeat: 2, duration: 1, velocity: 50 },
                ],
                'phrase-b': [
                    { id: 'b1', pitch: 79, startBeat: 0, duration: 1, velocity: 117 },
                    { id: 'b2', pitch: 83, startBeat: 2, duration: 1, velocity: 123 },
                ],
            },
        });
        const projection = projectPianoRollTakeNotes(
            state.tracks[0]!.clips[0]!,
            't',
            null,
            midiStore.value?.notesByClipId['phrase-a'] ?? []
        );
        setPianoRollSelection('phrase-a', ['a1'], ['phrase-a'], [{ clipId: 'phrase-a', projection }]);
        const musicalContentBinding = captureMusicalContentBinding();
        const query = (id: string) => ({
            id: `read-${id}`,
            name: 'project.query',
            arguments: { type: 'musical-content', filters: { stableId: id, startBeat: 0, endBeat: 4 } },
        });
        const requestTurn = vi
            .fn<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [query('phrase-a'), query('phrase-b')] })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'two-phrases',
            musicalContentBinding,
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result.status).toBe('complete');
        const receiptJson = requestTurn.mock.calls[1]?.[0].receiptContext?.split('\n').at(-1);
        if (receiptJson === undefined) {
            throw new Error('Expected serialized receipts in the provider continuation');
        }
        const note = (pitch: number, velocity: number) => expect.objectContaining({ kind: 'note', pitch, velocity });
        const receiptContext: unknown = JSON.parse(receiptJson);
        expect(receiptContext).toMatchObject({
            receipts: [
                {
                    callId: 'read-phrase-a',
                    status: 'success',
                    data: { items: expect.arrayContaining([note(60, 40), note(62, 50)]) },
                },
                {
                    callId: 'read-phrase-b',
                    status: 'success',
                    data: { items: expect.arrayContaining([note(79, 117), note(83, 123)]) },
                },
            ],
        });
    });

    it('sends a retryable stale musical cursor refusal to the next provider turn', async () => {
        const musicalContentBinding = captureMusicalContentBinding();
        const filters = { stableId: 'c', startBeat: 0, endBeat: 4 };
        const { nextCursor } = querySemanticProject({
            ...musicalContentBinding,
            type: 'musical-content',
            filters,
            page: { limit: 1 },
        });
        if (nextCursor === null) {
            throw new Error('Expected a real cursor issued for the original musical window');
        }
        const requestTurn = vi
            .fn<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'stale-page',
                        name: 'project.query',
                        arguments: {
                            type: 'musical-content',
                            filters: { ...filters, endBeat: 2 },
                            page: { limit: 1, cursor: nextCursor },
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'stale-musical-cursor',
            musicalContentBinding,
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result.status).toBe('complete');
        expect(requestTurn).toHaveBeenCalledTimes(2);
        const nextTurn = requestTurn.mock.calls[1]?.[0];
        expect(nextTurn?.turn).toBe(2);
        const receiptJson = nextTurn?.receiptContext?.split('\n').at(-1);
        if (receiptJson === undefined) {
            throw new Error('Expected serialized refusal evidence in the provider continuation');
        }
        const receiptContext: unknown = JSON.parse(receiptJson);
        expect(receiptContext).toMatchObject({
            receipts: [
                {
                    callId: 'stale-page',
                    toolName: 'project.query',
                    turn: 1,
                    status: 'failure',
                    revision: null,
                    data: null,
                    error: {
                        code: 'musical-content-refused',
                        safeMessage: 'Musical page cursor is stale or invalid; start a fresh request.',
                        retryable: true,
                    },
                },
            ],
        });
    });

    it.each([false, true])(
        'requires complete real musical pages before a fresh proposal (selected: %s)',
        async (selected) => {
            const state = structuredClone(trackStore.value!);
            state.tracks[0]!.clips[0]!.endBeat = 12;
            setTrackStoreState(state);
            const projection = projectPianoRollTakeNotes(
                state.tracks[0]!.clips[0]!,
                't',
                null,
                midiStore.value?.notesByClipId.c ?? []
            );
            setPianoRollSelection('c', selected ? ['n'] : [], ['c'], [{ clipId: 'c', projection }]);
            const musicalContentBinding = captureMusicalContentBinding();
            const authority = {
                schemaVersion: 1 as const,
                authorityId: 'a',
                catalogId: 'catalog',
                requestDigest: 'request',
                revision: 'revision',
                selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
                mode: 'edit' as const,
                targets: [
                    {
                        provenance: 'contextual-selection' as const,
                        objectType: 'clip' as const,
                        objectIds: ['c'],
                        parentTrackId: 't',
                    },
                ],
                editDimensions: ['midi-content' as const],
                prohibitions: [],
                creationSlots: [],
                uncertainty: 'none' as const,
            };
            let admitted = false;
            const requestTurn = vi.fn(
                async ({
                    turn,
                    receiptContext,
                }: {
                    turn: number;
                    receiptContext: string | null;
                    directive: { mode: string };
                    budgetNote: string;
                }) => {
                    if (turn === 1) {
                        return {
                            status: 'complete' as const,
                            toolCalls: [{ id: 'interpret', name: 'interpret', arguments: {} }],
                        };
                    }
                    if (turn === 2) {
                        return {
                            status: 'complete' as const,
                            toolCalls: [{ id: 'premature', name: 'setTempo', arguments: { bpm: 120 } }],
                        };
                    }
                    if (turn === 3) {
                        return {
                            status: 'complete' as const,
                            toolCalls: [
                                {
                                    id: 'read',
                                    name: 'project.query',
                                    arguments: {
                                        type: 'musical-content',
                                        filters: { stableId: 'c', startBeat: 0, endBeat: selected ? 4 : 12 },
                                        page: { limit: 50 },
                                    },
                                },
                            ],
                        };
                    }
                    expect(receiptContext).toContain('"pitch":36');
                    return {
                        status: 'complete' as const,
                        toolCalls: [{ id: 'fresh', name: 'setTempo', arguments: { bpm: 120 } }],
                    };
                }
            );
            const result = await runApplicationOwnedToolLoop({
                loopId: 'read-gate',
                musicalContentBinding,
                readCreativeAuthority: () => (admitted ? authority : undefined),
                interpretation: {
                    toolName: 'interpret',
                    admit: () => {
                        admitted = true;
                        return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                    },
                },
                terminalToolNames: new Set(['setTempo']),
                requestTurn,
            });
            expect(result.status).toBe('complete');
            if (result.status !== 'complete') {
                throw new Error('Expected a completed planning result');
            }
            expect(result.toolCalls.map((call) => call.id)).toEqual(['fresh']);
            expect(requestTurn.mock.calls[1]?.[0].directive).toEqual({
                mode: 'required',
                toolNames: ['project.query'],
                parallelToolCalls: false,
            });
            expect(requestTurn.mock.calls[1]?.[0].budgetNote).toContain(`"endBeat":${selected ? '4' : '12'}`);
            expect(requestTurn.mock.calls[2]?.[0].receiptContext).toContain('musical-read-required');
            expect(result.receipts.some((receipt) => receipt.error?.code === 'musical-read-required')).toBe(true);
            expect(
                result.receipts.some((receipt) => receipt.toolName === 'project.query' && receipt.status === 'success')
            ).toBe(true);
        }
    );

    it('does not let an offered workflow carry an unrelated command past the musical read', async () => {
        const binding = captureMusicalContentBinding();
        const authority = {
            schemaVersion: 1 as const,
            authorityId: 'a',
            catalogId: 'catalog',
            requestDigest: 'request',
            revision: 'revision',
            selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
            mode: 'edit' as const,
            targets: [
                {
                    provenance: 'contextual-selection' as const,
                    objectType: 'clip' as const,
                    objectIds: ['c'],
                    parentTrackId: 't',
                },
            ],
            editDimensions: ['midi-content' as const],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none' as const,
        };
        let admitted = false;
        const result = await runApplicationOwnedToolLoop({
            loopId: 'mixed-workflow',
            musicalContentBinding: binding,
            offeredMusicalWorkflows: ['syncopated-arpeggio'],
            readCreativeAuthority: () => (admitted ? authority : undefined),
            interpretation: {
                toolName: 'interpret',
                admit: () => {
                    admitted = true;
                    return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                },
            },
            terminalToolNames: new Set(['selectWorkflowCapability', 'command.batch.propose']),
            requestTurn: async ({ turn }) => {
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [{ id: 'intake', name: 'interpret', arguments: {} }] };
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: `selection-${turn}`,
                            name: 'selectWorkflowCapability',
                            arguments: { capabilityId: 'syncopated-arpeggio' },
                        },
                        {
                            id: `proposal-${turn}`,
                            name: 'command.batch.propose',
                            arguments: {
                                commands: [
                                    { name: 'arpeggiate', arguments: {} },
                                    { name: 'setTempo', arguments: { bpm: 120 } },
                                ],
                            },
                        },
                    ],
                };
            },
        });
        expect(result.status).toBe('rejected');
        expect(result.receipts.some((receipt) => receipt.error?.code === 'musical-read-required')).toBe(true);
    });

    it('requires each cursor page from the real query before accepting a proposal', async () => {
        setPianoRollSelection('c', [], ['c']);
        const musicalContentBinding = captureMusicalContentBinding();
        const authority = {
            schemaVersion: 1 as const,
            authorityId: 'a',
            catalogId: 'catalog',
            requestDigest: 'request',
            revision: 'revision',
            selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
            mode: 'edit' as const,
            targets: [
                {
                    provenance: 'contextual-selection' as const,
                    objectType: 'clip' as const,
                    objectIds: ['c'],
                    parentTrackId: 't',
                },
            ],
            editDimensions: ['midi-content' as const],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none' as const,
        };
        let admitted = false;
        let cursor: string | undefined;
        const result = await runApplicationOwnedToolLoop({
            loopId: 'complete-pages',
            musicalContentBinding,
            readCreativeAuthority: () => (admitted ? authority : undefined),
            interpretation: {
                toolName: 'interpret',
                admit: () => {
                    admitted = true;
                    return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                },
            },
            terminalToolNames: new Set(['setTempo']),
            requestTurn: async ({ turn, receiptContext }) => {
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [{ id: 'interpret', name: 'interpret', arguments: {} }] };
                }
                if (turn > 2) {
                    const parsed = JSON.parse(receiptContext!.slice(receiptContext!.lastIndexOf('\n') + 1));
                    const last = parsed.receipts.at(-1);
                    cursor = last.data.nextCursor ?? undefined;
                    if (!cursor) {
                        return {
                            status: 'complete',
                            toolCalls: [{ id: 'proposal', name: 'setTempo', arguments: { bpm: 120 } }],
                        };
                    }
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: `page-${turn}`,
                            name: 'project.query',
                            arguments: {
                                type: 'musical-content',
                                filters: { stableId: 'c', startBeat: 0, endBeat: 4 },
                                page: { limit: 1, cursor },
                            },
                        },
                    ],
                };
            },
        });
        expect(result.status).toBe('complete');
        expect(
            result.receipts.filter((receipt) => receipt.toolName === 'project.query' && receipt.status === 'success')
        ).toHaveLength(3);
    });

    it('locates a selected source beyond beat 128 without scanning the clip prefix', async () => {
        const state = structuredClone(trackStore.value!);
        state.tracks[0]!.clips[0]!.endBeat = 256;
        setTrackStoreState(state);
        const note = { id: 'late', pitch: 70, startBeat: 201, duration: 1, velocity: 90 };
        setMidiStoreState({ ...structuredClone(defaultMidiStoreState), notesByClipId: { c: [note] } });
        const projection = projectPianoRollTakeNotes(state.tracks[0]!.clips[0]!, 't', null, [note]);
        setPianoRollSelection('c', ['late'], ['c'], [{ clipId: 'c', projection }]);
        const authority = {
            schemaVersion: 1 as const,
            authorityId: 'a',
            catalogId: 'catalog',
            requestDigest: 'request',
            revision: 'revision',
            selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
            mode: 'edit' as const,
            targets: [
                {
                    provenance: 'contextual-selection' as const,
                    objectType: 'clip' as const,
                    objectIds: ['c'],
                    parentTrackId: 't',
                },
            ],
            editDimensions: ['midi-content' as const],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none' as const,
        };
        let admitted = false;
        const budgetNotes: string[] = [];
        const result = await runApplicationOwnedToolLoop({
            loopId: 'late-selected',
            musicalContentBinding: captureMusicalContentBinding(),
            readCreativeAuthority: () => (admitted ? authority : undefined),
            interpretation: {
                toolName: 'interpret',
                admit: () => {
                    admitted = true;
                    return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                },
            },
            terminalToolNames: new Set(['setTempo']),
            requestTurn: async ({ turn, budgetNote, receiptContext }) => {
                budgetNotes.push(budgetNote);
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [{ id: 'intake', name: 'interpret', arguments: {} }] };
                }
                if (turn === 2) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'late-read',
                                name: 'project.query',
                                arguments: {
                                    type: 'musical-content',
                                    filters: { stableId: 'c', startBeat: 200, endBeat: 204 },
                                    page: { limit: 50 },
                                },
                            },
                        ],
                    };
                }
                expect(receiptContext).toContain('"noteId":"late"');
                return {
                    status: 'complete',
                    toolCalls: [{ id: 'proposal', name: 'setTempo', arguments: { bpm: 120 } }],
                };
            },
        });
        expect(result.status).toBe('complete');
        expect(budgetNotes[1]).toContain('"startBeat":200');
    });

    it('uses the actual late frozen view occurrence for selected read coverage', async () => {
        const state = structuredClone(trackStore.value!);
        const clip = state.tracks[0]!.clips[0]!;
        clip.endBeat = 208;
        clip.loopEnabled = true;
        clip.loopLength = 4;
        setTrackStoreState(state);
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 't',
                    takes: [
                        {
                            id: 'take',
                            clipId: 'c',
                            name: 'Take',
                            startBeat: 200,
                            endBeat: 208,
                            selected: true,
                            midiSource: {
                                sourceClipId: 'source',
                                sourceEntryBeat: 0,
                                sourceEndBeat: 4,
                                phaseHeadBeat: 200,
                                passLengthBeats: 4,
                                rows: {
                                    notes: {
                                        present: true,
                                        value: [{ id: 'frozen', pitch: 69, startBeat: 1, duration: 1, velocity: 80 }],
                                    },
                                    controlChanges: { present: true, value: [] },
                                    pitchBends: { present: true, value: [] },
                                },
                            },
                        },
                    ],
                    activeCompRegions: [{ startBeat: 200, endBeat: 208, takeId: 'take' }],
                },
            ],
        });
        const projection = projectPianoRollTakeNotes(clip, 't', takeLaneStore.value, []);
        const view = projection.notes.at(-1);
        expect(view).toBeDefined();
        setPianoRollSelection('c', [view!.id], ['c'], [{ clipId: 'c', projection }]);
        const authority = {
            schemaVersion: 1 as const,
            authorityId: 'a',
            catalogId: 'catalog',
            requestDigest: 'request',
            revision: 'revision',
            selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
            mode: 'edit' as const,
            targets: [
                {
                    provenance: 'contextual-selection' as const,
                    objectType: 'clip' as const,
                    objectIds: ['c'],
                    parentTrackId: 't',
                },
            ],
            editDimensions: ['midi-content' as const],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none' as const,
        };
        let admitted = false;
        const budgetNotes: string[] = [];
        const result = await runApplicationOwnedToolLoop({
            loopId: 'late-frozen',
            musicalContentBinding: captureMusicalContentBinding(),
            readCreativeAuthority: () => (admitted ? authority : undefined),
            interpretation: {
                toolName: 'interpret',
                admit: () => {
                    admitted = true;
                    return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                },
            },
            terminalToolNames: new Set(['setTempo']),
            requestTurn: async ({ turn, budgetNote, receiptContext }) => {
                budgetNotes.push(budgetNote);
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [{ id: 'intake', name: 'interpret', arguments: {} }] };
                }
                if (turn === 2) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'read',
                                name: 'project.query',
                                arguments: {
                                    type: 'musical-content',
                                    filters: { stableId: 'c', startBeat: 204, endBeat: 208 },
                                    page: { limit: 50 },
                                },
                            },
                        ],
                    };
                }
                expect(receiptContext).toContain('"noteId":"frozen"');
                return {
                    status: 'complete',
                    toolCalls: [{ id: 'proposal', name: 'setTempo', arguments: { bpm: 120 } }],
                };
            },
        });
        expect(result.status).toBe('complete');
        expect(budgetNotes[1]).toContain('"startBeat":204');
    });

    it.each(['wrong-window', 'partial', 'stale', 'await-stale'] as const)(
        'does not accept a proposal after a %s musical read',
        async (failure) => {
            setPianoRollSelection('c', [], ['c']);
            const musicalContentBinding = captureMusicalContentBinding();
            const authority = {
                schemaVersion: 1 as const,
                authorityId: 'a',
                catalogId: 'catalog',
                requestDigest: 'request',
                revision: 'revision',
                selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
                mode: 'edit' as const,
                targets: [
                    {
                        provenance: 'contextual-selection' as const,
                        objectType: 'clip' as const,
                        objectIds: ['c'],
                        parentTrackId: 't',
                    },
                ],
                editDimensions: ['midi-content' as const],
                prohibitions: [],
                creationSlots: [],
                uncertainty: 'none' as const,
            };
            let admitted = false;
            const result = await runApplicationOwnedToolLoop({
                loopId: 'incomplete-read',
                musicalContentBinding,
                readCreativeAuthority: () => (admitted ? authority : undefined),
                interpretation: {
                    toolName: 'interpret',
                    admit: () => {
                        admitted = true;
                        return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                    },
                },
                terminalToolNames: new Set(['setTempo']),
                requestTurn: async ({ turn }) => {
                    if (turn === 1) {
                        return {
                            status: 'complete',
                            toolCalls: [{ id: 'interpret', name: 'interpret', arguments: {} }],
                        };
                    }
                    if (turn === 2) {
                        if (failure === 'stale') {
                            setPianoRollSelection('c', [], ['c']);
                        }
                        return {
                            status: 'complete',
                            toolCalls: [
                                {
                                    id: 'read',
                                    name: 'project.query',
                                    arguments: {
                                        type: 'musical-content',
                                        filters: {
                                            stableId: 'c',
                                            startBeat: 0,
                                            endBeat: failure === 'wrong-window' ? 2 : 4,
                                        },
                                        page: { limit: failure === 'partial' ? 1 : 50 },
                                    },
                                },
                            ],
                        };
                    }
                    if (failure === 'await-stale') {
                        setPianoRollSelection('c', [], ['c']);
                    }
                    return {
                        status: 'complete',
                        toolCalls: [{ id: `proposal-${turn}`, name: 'setTempo', arguments: { bpm: 120 } }],
                    };
                },
            });
            expect(result.status).toBe('rejected');
            expect(
                failure === 'stale' ||
                    failure === 'await-stale' ||
                    result.receipts.some((receipt) => receipt.error?.code === 'musical-read-required')
            ).toBe(true);
        }
    );

    it('keeps processing-only interpretation available without musical binding', async () => {
        const authority = {
            schemaVersion: 1 as const,
            authorityId: 'a',
            catalogId: 'catalog',
            requestDigest: 'request',
            revision: 'revision',
            selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
            mode: 'edit' as const,
            targets: [
                {
                    provenance: 'contextual-selection' as const,
                    objectType: 'clip' as const,
                    objectIds: ['c'],
                    parentTrackId: 't',
                },
            ],
            editDimensions: ['processing' as const],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none' as const,
        };
        let admitted = false;
        const result = await runApplicationOwnedToolLoop({
            loopId: 'processing',
            readCreativeAuthority: () => (admitted ? authority : undefined),
            interpretation: {
                toolName: 'interpret',
                admit: () => {
                    admitted = true;
                    return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                },
            },
            terminalToolNames: new Set(['setTempo']),
            requestTurn: async ({ turn }) => {
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [{ id: 'intake', name: 'interpret', arguments: {} }] };
                }
                return {
                    status: 'complete',
                    toolCalls: [{ id: 'proposal', name: 'setTempo', arguments: { bpm: 120 } }],
                };
            },
        });
        expect(result.status).toBe('complete');
    });

    it('refuses provider-authored musical binding without an application capture', async () => {
        const binding = captureMusicalContentBinding();
        const result = await runApplicationOwnedToolLoop({
            loopId: 'forged-binding',
            terminalToolNames: new Set(['setTempo']),
            requestTurn: async ({ turn }) => {
                if (turn === 1) {
                    return {
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'forged',
                                name: 'project.query',
                                arguments: {
                                    type: 'musical-content',
                                    filters: { stableId: 'c', startBeat: 0, endBeat: 4 },
                                    ...binding,
                                },
                            },
                        ],
                    };
                }
                return { status: 'complete', toolCalls: [] };
            },
        });
        expect(result.receipts[0]).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('allows a safe decline without demanding musical data', async () => {
        setPianoRollSelection('c', [], ['c']);
        const authority = {
            schemaVersion: 1 as const,
            authorityId: 'a',
            catalogId: 'catalog',
            requestDigest: 'request',
            revision: 'revision',
            selection: { trackId: 't', clipId: 'c', clipIds: ['c'], activeView: 'clip' as const },
            mode: 'edit' as const,
            targets: [
                {
                    provenance: 'contextual-selection' as const,
                    objectType: 'clip' as const,
                    objectIds: ['c'],
                    parentTrackId: 't',
                },
            ],
            editDimensions: ['midi-content' as const],
            prohibitions: [],
            creationSlots: [],
            uncertainty: 'none' as const,
        };
        let admitted = false;
        const result = await runApplicationOwnedToolLoop({
            loopId: 'decline',
            musicalContentBinding: captureMusicalContentBinding(),
            readCreativeAuthority: () => (admitted ? authority : undefined),
            interpretation: {
                toolName: 'interpret',
                admit: () => {
                    admitted = true;
                    return { status: 'admitted', receipt: { data: {}, summary: 'admitted' } };
                },
            },
            terminalToolNames: new Set(['command.batch.decline']),
            requestTurn: async ({ turn }) => {
                if (turn === 1) {
                    return { status: 'complete', toolCalls: [{ id: 'intake', name: 'interpret', arguments: {} }] };
                }
                return {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'decline',
                            name: 'command.batch.decline',
                            arguments: { kind: 'clarify', reason: 'Which phrase?', questions: ['Which phrase?'] },
                        },
                    ],
                };
            },
        });
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') {
            throw new Error('Expected a completed decline');
        }
        expect(result.decline?.kind).toBe('clarify');
        expect(result.receipts.some((receipt) => receipt.toolName === 'project.query')).toBe(false);
    });

    it.each(['object', 'project-summary'] as const)(
        'carries the actual owner %s receipt into the next provider turn without project mutations',
        async (type) => {
            const before = captureProjectRevision();
            const query: Parameters<typeof querySemanticProject>[0] = { type };
            if (type === 'object') {
                query.filters = { kind: 'track' };
            }
            const ownerReceipt = querySemanticProject(query);
            const context = getProjectContext();
            const providerMessage = buildAgentContext({
                fixedPolicy: 'policy',
                prompt: 'Inspect the track role',
                context,
                projectRevision: before,
            }).message;
            expect(providerMessage).toContain('"canonicalRole":{"role":"kick","source":"clip-content"');
            type Turn = Parameters<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>[0];
            const requestTurn = vi.fn(async (turn: Turn) => {
                if (turn.turn === 1) {
                    return {
                        status: 'complete' as const,
                        toolCalls: [
                            {
                                id: 'role-query',
                                name: 'project.query',
                                arguments: query,
                            },
                        ],
                        providerTurn: {
                            provider: 'openai' as const,
                            assistantItems: [{ type: 'function_call', call_id: 'role-query' }],
                        },
                    };
                }
                expect(turn.history[0]?.receipts[0]?.data).toEqual(ownerReceipt);
                expect(turn.receiptContext).toContain('"canonicalRole":{"role":"kick","source":"clip-content"');
                return { status: 'complete' as const, toolCalls: [] };
            });
            const result = await runApplicationOwnedToolLoop({
                loopId: 'canonical-roles',
                terminalToolNames: new Set(['setTempo']),
                requestTurn,
            });
            expect(result.status).toBe('complete');
            expect(requestTurn).toHaveBeenCalledTimes(2);
            expect(result.receipts[0]?.data).toEqual(ownerReceipt);
            expect(result.receipts[0]?.status).toBe('success');
            expect(JSON.stringify(result.receipts)).not.toMatch(/"notes"|"pitch"|"velocity"|audioBuffers|deviceState/);
            expect(captureProjectRevision()).toBe(before);
        }
    );
});
