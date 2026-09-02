import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, getArrangementHandlers, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '../../stores/undoStore';
import { isExecutableAppActionType } from '../executableAppActionRegistry';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { getExecutableAppActionGroundingCatalog } from '../getExecutableAppActionGroundingCatalog';
import { getExecutableAppActionIntentCatalog } from '../getExecutableAppActionIntentCatalog';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';
import { getExecutableCommandRegistration } from '../getExecutableCommandRegistration';
import { getInternalUndoSessionReplayContracts } from '../getInternalUndoSessionReplayContracts';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { undo } from '../undo';

function createPersistedAddNotesEntry() {
    const noteTransformReplayGuard = {
        trackId: 'track-midi',
        expectedTrackFrozen: false,
        expectedClipLocked: false,
    };
    const baseNotes = [
        { id: 'existing-1', pitch: 48, startBeat: 0, duration: 1, velocity: 80 },
        { id: 'existing-2', pitch: 52, startBeat: 1, duration: 1, velocity: 84 },
    ];
    const notes = [
        { id: 'note-1', pitch: 60, startBeat: 2, duration: 1, velocity: 100, probability: 100 },
        { id: 'note-2', pitch: 64, startBeat: 3, duration: 1, velocity: 96, probability: 100 },
    ];
    const expectedNotes = [...baseNotes, ...notes];
    return {
        id: 'undo-add-note',
        kind: 'action',
        label: 'Add MIDI note',
        action: {
            type: 'addNotes',
            payload: { clipId: 'clip-midi', notes },
        },
        inverseAction: {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'clip-midi',
                notes: baseNotes,
                expectedNotes,
                notesBucketPresent: true,
                expectedNotesBucketPresent: true,
                noteTransformReplayGuard,
            },
        },
        redoAction: {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'clip-midi',
                notes: expectedNotes,
                expectedNotes: baseNotes,
                notesBucketPresent: true,
                expectedNotesBucketPresent: true,
                noteTransformReplayGuard,
            },
        },
        timestamp: 1,
        source: 'ai',
    };
}

function registerAllProductionHandlers(): void {
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
    ]);
}

function createMidiClipFixture(): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: 'track-midi', kind: 'midi', name: 'MIDI' })],
    });
    if (
        addClip({
            id: 'clip-midi',
            trackId: 'track-midi',
            startBeat: 0,
            endBeat: 8,
            name: 'MIDI clip',
            type: 'midi',
        }) === null
    ) {
        throw new Error('Expected MIDI clip fixture');
    }
}

function flushUndoSessionWrite(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

function reloadUndoHistoryThroughProductionRegistration(): void {
    clearHandlerRegistry();
    undoStore.set({ past: [], future: [] });
    expect(undoStore.value).toEqual({ past: [], future: [] });
    registerAllProductionHandlers();
}

describe('addNotes command registration', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
    });

    afterEach(() => {
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
    });

    it('registers addNotes as an executable, hidden, application-materialized MIDI mutation', () => {
        expect(isExecutableAppActionType('addNotes')).toBe(true);

        const registration = getExecutableCommandRegistration('addNotes');

        expect(registration).toMatchObject({
            actionType: 'addNotes',
            risk: 'bounded-reversible',
            discoverability: 'hidden',
            mutationIdempotent: false,
            targetChecks: [
                {
                    argument: 'clipId',
                    capability: 'writable-midi-clip',
                    allowBatchLocal: true,
                },
            ],
            mutationIdentityRules: [
                { arguments: [{ argument: 'clipId' }], resourceFamily: 'clip' },
                {
                    arguments: [
                        {
                            argument: 'parentTrackIds',
                            cardinality: 'many',
                            source: 'app-derived',
                            targetCapabilities: ['writable-midi-clip'],
                        },
                    ],
                    destructive: false,
                    resourceFamily: 'track',
                    resourceReferenceOnly: true,
                },
            ],
        });
        expect(registration.confirmation.required).toBe(false);
        expect(registration.noOpDetector?.({ type: 'addNotes', payload: { clipId: 'clip-midi', notes: [] } })).toBe(
            true
        );
        expect(
            registration.noOpDetector?.({
                type: 'addNotes',
                payload: { clipId: 'clip-midi', notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
            })
        ).toBe(false);
        expect(registration.providerSchema.required).toEqual(['clipId', 'notes']);
        expect(registration.providerSchema.properties).toEqual({
            clipId: { type: 'string' },
            notes: {
                type: 'array',
                minItems: 1,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        pitch: { type: 'number', minimum: 0, maximum: 127 },
                        startBeat: { type: 'number', minimum: 0 },
                        duration: { type: 'number', exclusiveMinimum: 0 },
                        velocity: { type: 'number', minimum: 1, maximum: 127 },
                    },
                    required: ['pitch', 'startBeat', 'duration'],
                },
            },
        });
        expect(
            registration.runtimeSchema.validate({
                clipId: 'clip-midi',
                notes: [{ id: 'note-command-1', pitch: 60, startBeat: 0, duration: 1, velocity: 96 }],
            })
        ).toBe(true);
    });

    it('keeps the executable command out of general provider and planner discovery', () => {
        expect(getExecutableAppActionToolSchemas().map((schema) => schema.function.name)).not.toContain('addNotes');
        expect(getExecutableAppActionGroundingCatalog().map((entry) => entry.actionType)).not.toContain('addNotes');
        expect(
            getExecutableAppActionIntentCatalog({ intent: 'add notes', page: { limit: 8 } }).items.map(
                (entry) => entry.name
            )
        ).not.toContain('addNotes');
    });

    it('hydrates and replays an exact addNotes restore pair through production registration', async () => {
        const registration = getExecutableCommandRegistration('addNotes');
        const entry = createPersistedAddNotesEntry();
        createMidiClipFixture();
        midiStore.set({
            notesByClipId: { 'clip-midi': entry.redoAction.payload.notes },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [
                    {
                        ...entry,
                        actionOperationVersion: registration.operationVersion,
                        inverseActionOperationVersion: 1,
                        redoActionOperationVersion: 1,
                    },
                ],
                future: [],
            })
        );
        clearHandlerRegistry();
        registerAllProductionHandlers();

        expect(undoStore.value?.past).toMatchObject([entry]);
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(entry.redoAction.payload.notes);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(entry.inverseAction.payload.notes);
        await redo();
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(entry.redoAction.payload.notes);
    });

    it('persists and rehydrates a canonical undo entry from an envelope-less addNotes action', async () => {
        createMidiClipFixture();
        midiStore.set({
            notesByClipId: { 'clip-midi': [{ id: 'base', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        clearHandlerRegistry();
        registerAllProductionHandlers();

        await executeAppAction({
            type: 'addNotes',
            payload: {
                clipId: 'clip-midi',
                notes: [{ id: 'note-single', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 }],
            },
        });
        await flushUndoSessionWrite();
        reloadUndoHistoryThroughProductionRegistration();

        const expectedNotes = [
            { id: 'base', pitch: 48, startBeat: 0, duration: 1, velocity: 80 },
            { id: 'note-single', pitch: 61, startBeat: 0, duration: 0.0625, velocity: 97, probability: 100 },
        ];
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(expectedNotes);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual([expectedNotes[0]!]);
        await redo();
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(expectedNotes);
    });

    it('persists and rehydrates canonical history from an envelope-less noncanonical addNotes batch', async () => {
        createMidiClipFixture();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        clearHandlerRegistry();
        registerAllProductionHandlers();

        await expect(
            executeAppActionBatch([
                {
                    type: 'addNotes',
                    payload: {
                        clipId: 'clip-midi',
                        notes: [{ id: 'note-batch', pitch: 60.6, startBeat: -2, duration: 0.01, velocity: 96.7 }],
                    },
                },
            ])
        ).resolves.toMatchObject({ status: 'committed' });
        await flushUndoSessionWrite();
        reloadUndoHistoryThroughProductionRegistration();

        const expectedNotes = [
            { id: 'note-batch', pitch: 61, startBeat: 0, duration: 0.0625, velocity: 97, probability: 100 },
        ];
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(expectedNotes);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(midiStore.value?.notesByClipId).not.toHaveProperty('clip-midi');
        await redo();
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(expectedNotes);
    });

    it('persists and rehydrates ordered same-clip addNotes group snapshots', async () => {
        createMidiClipFixture();
        const baseNotes = [{ id: 'base', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }];
        midiStore.set({ notesByClipId: { 'clip-midi': baseNotes }, ccByClipId: {}, pitchBendByClipId: {} });
        clearHandlerRegistry();
        registerAllProductionHandlers();

        await expect(
            executeAppActionBatch(
                [
                    {
                        type: 'addNotes',
                        payload: {
                            clipId: 'clip-midi',
                            notes: [{ id: 'note-first', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
                        },
                    },
                    {
                        type: 'addNotes',
                        payload: {
                            clipId: 'clip-midi',
                            notes: [{ id: 'note-second', pitch: 64, startBeat: 2, duration: 1, velocity: 96 }],
                        },
                    },
                ],
                { groupId: 'same-clip-persisted' }
            )
        ).resolves.toMatchObject({ status: 'committed' });
        await flushUndoSessionWrite();
        reloadUndoHistoryThroughProductionRegistration();

        const expectedNotes = [
            ...baseNotes,
            { id: 'note-first', pitch: 60, startBeat: 1, duration: 1, velocity: 100, probability: 100 },
            { id: 'note-second', pitch: 64, startBeat: 2, duration: 1, velocity: 96, probability: 100 },
        ];
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(expectedNotes);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(baseNotes);
        await redo();
        expect(midiStore.value?.notesByClipId['clip-midi']).toEqual(expectedNotes);
    });

    it.each([
        [
            'cross-clip inverse',
            () => {
                const entry = createPersistedAddNotesEntry();
                return {
                    ...entry,
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, clipId: 'clip-other' },
                    },
                };
            },
        ],
        [
            'mismatched snapshots',
            () => {
                const entry = createPersistedAddNotesEntry();
                const mismatchedNotes = entry.inverseAction.payload.expectedNotes.map((note, index) =>
                    index === entry.inverseAction.payload.expectedNotes.length - 1 ? { ...note, pitch: 61 } : note
                );
                return {
                    ...entry,
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: {
                            ...entry.inverseAction.payload,
                            expectedNotes: mismatchedNotes,
                        },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: mismatchedNotes },
                    },
                };
            },
        ],
        [
            'a changed base note in the expected replay snapshots',
            () => {
                const entry = createPersistedAddNotesEntry();
                const changedBaseNotes = entry.inverseAction.payload.notes.map((note, index) =>
                    index === 0 ? { ...note, velocity: 81 } : note
                );
                const expectedNotes = [...changedBaseNotes, ...entry.action.payload.notes];
                return {
                    ...entry,
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, expectedNotes },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: expectedNotes },
                    },
                };
            },
        ],
        [
            'duplicate materialized ids',
            () => {
                const entry = createPersistedAddNotesEntry();
                const duplicatedNotes = [...entry.action.payload.notes, { ...entry.action.payload.notes[0]! }];
                const expectedNotes = [...entry.inverseAction.payload.notes, ...duplicatedNotes];
                return {
                    ...entry,
                    action: {
                        ...entry.action,
                        payload: {
                            ...entry.action.payload,
                            notes: duplicatedNotes,
                        },
                    },
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, expectedNotes },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: expectedNotes },
                    },
                };
            },
        ],
        [
            'a materialized id that collides with the pre-add snapshot',
            () => {
                const entry = createPersistedAddNotesEntry();
                const collidingNotes = [
                    { ...entry.action.payload.notes[0]!, id: entry.inverseAction.payload.notes[0]!.id },
                    entry.action.payload.notes[1]!,
                ];
                const expectedNotes = [...entry.inverseAction.payload.notes, ...collidingNotes];
                return {
                    ...entry,
                    action: { ...entry.action, payload: { ...entry.action.payload, notes: collidingNotes } },
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, expectedNotes },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: expectedNotes },
                    },
                };
            },
        ],
        [
            'missing materialized ids',
            () => {
                const entry = createPersistedAddNotesEntry();
                const missingIdNotes = [
                    { pitch: 60, startBeat: 2, duration: 1, velocity: 100, probability: 100 },
                    entry.action.payload.notes[1]!,
                ];
                const expectedNotes = [...entry.inverseAction.payload.notes, ...missingIdNotes];
                return {
                    ...entry,
                    action: {
                        ...entry.action,
                        payload: {
                            ...entry.action.payload,
                            notes: missingIdNotes,
                        },
                    },
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, expectedNotes },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: expectedNotes },
                    },
                };
            },
        ],
        [
            'a widened missing-empty replay flag',
            () => {
                const entry = createPersistedAddNotesEntry();
                return {
                    ...entry,
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, allowMissingExpectedEmpty: true },
                    },
                };
            },
        ],
        [
            'mismatched MIDI notes bucket presence',
            () => {
                const entry = createPersistedAddNotesEntry();
                return {
                    ...entry,
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, expectedNotesBucketPresent: false },
                    },
                };
            },
        ],
        [
            'a redo replay guard for another track',
            () => {
                const entry = createPersistedAddNotesEntry();
                return {
                    ...entry,
                    redoAction: {
                        ...entry.redoAction,
                        payload: {
                            ...entry.redoAction.payload,
                            noteTransformReplayGuard: {
                                ...entry.redoAction.payload.noteTransformReplayGuard,
                                trackId: 'track-other',
                            },
                        },
                    },
                };
            },
        ],
    ])('truncates reachable history for %s', (_description, createInvalidEntry) => {
        const registration = getExecutableCommandRegistration('addNotes');
        const entry = createInvalidEntry();
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [
                    {
                        ...entry,
                        actionOperationVersion: registration.operationVersion,
                        inverseActionOperationVersion: 1,
                        redoActionOperationVersion: 1,
                    },
                ],
                future: [],
            })
        );

        hydrateUndoStoreFromSession([
            {
                actionType: registration.actionType,
                operationVersion: registration.operationVersion,
                role: 'forward',
                validateArguments: registration.runtimeSchema.validate,
                validateEntry: registration.sessionEntryValidator,
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);

        expect(undoStore.value?.past).toEqual([]);
    });

    it.each([
        ['channel', 1],
        ['pressure', 0.5],
        ['slide', 0.5],
        ['pitchBend', 0.5],
        ['pitchBendRangeSemitones', 2],
        ['articulation', 'staccato'],
    ])('rejects a future redo snapshot with state-significant %s', (field, value) => {
        const registration = getExecutableCommandRegistration('addNotes');
        const entry = createPersistedAddNotesEntry();
        const tamperedNotes = entry.action.payload.notes.map((note, index) =>
            index === 0 ? { ...note, [field]: value } : note
        );
        const expectedNotes = [...entry.inverseAction.payload.notes, ...tamperedNotes];
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [],
                future: [
                    {
                        ...entry,
                        action: { ...entry.action, payload: { ...entry.action.payload, notes: tamperedNotes } },
                        inverseAction: {
                            ...entry.inverseAction,
                            payload: { ...entry.inverseAction.payload, expectedNotes },
                        },
                        redoAction: {
                            ...entry.redoAction,
                            payload: { ...entry.redoAction.payload, notes: expectedNotes },
                        },
                        actionOperationVersion: registration.operationVersion,
                        inverseActionOperationVersion: 1,
                        redoActionOperationVersion: 1,
                    },
                ],
            })
        );

        hydrateUndoStoreFromSession([
            {
                actionType: registration.actionType,
                operationVersion: registration.operationVersion,
                role: 'forward',
                validateArguments: registration.runtimeSchema.validate,
                validateEntry: registration.sessionEntryValidator,
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);

        expect(undoStore.value?.future).toEqual([]);
    });

    it('rejects a future addNotes pair whose materialized probability is not canonical', () => {
        const registration = getExecutableCommandRegistration('addNotes');
        const entry = createPersistedAddNotesEntry();
        const nonCanonicalNotes = entry.action.payload.notes.map((note, index) =>
            index === 0 ? { ...note, probability: 99 } : note
        );
        const expectedNotes = [...entry.inverseAction.payload.notes, ...nonCanonicalNotes];
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [],
                future: [
                    {
                        ...entry,
                        action: { ...entry.action, payload: { ...entry.action.payload, notes: nonCanonicalNotes } },
                        inverseAction: {
                            ...entry.inverseAction,
                            payload: { ...entry.inverseAction.payload, expectedNotes },
                        },
                        redoAction: {
                            ...entry.redoAction,
                            payload: { ...entry.redoAction.payload, notes: expectedNotes },
                        },
                        actionOperationVersion: registration.operationVersion,
                        inverseActionOperationVersion: 1,
                        redoActionOperationVersion: 1,
                    },
                ],
            })
        );

        hydrateUndoStoreFromSession([
            {
                actionType: registration.actionType,
                operationVersion: registration.operationVersion,
                role: 'forward',
                validateArguments: registration.runtimeSchema.validate,
                validateEntry: registration.sessionEntryValidator,
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);

        expect(undoStore.value?.future).toEqual([]);
    });

    it.each([
        ['pitch', 128],
        ['pitch', 60.5],
        ['startBeat', -1],
        ['duration', 0],
        ['velocity', 128],
        ['velocity', 96.5],
    ])('rejects a consistent restore pair with non-canonical %s', (field, value) => {
        const registration = getExecutableCommandRegistration('addNotes');
        const entry = createPersistedAddNotesEntry();
        const tamperedNotes = entry.action.payload.notes.map((note, index) =>
            index === 0 ? { ...note, [field]: value } : note
        );
        const expectedNotes = [...entry.inverseAction.payload.notes, ...tamperedNotes];
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [
                    {
                        ...entry,
                        action: { ...entry.action, payload: { ...entry.action.payload, notes: tamperedNotes } },
                        inverseAction: {
                            ...entry.inverseAction,
                            payload: { ...entry.inverseAction.payload, expectedNotes },
                        },
                        redoAction: {
                            ...entry.redoAction,
                            payload: { ...entry.redoAction.payload, notes: expectedNotes },
                        },
                        actionOperationVersion: registration.operationVersion,
                        inverseActionOperationVersion: 1,
                        redoActionOperationVersion: 1,
                    },
                ],
                future: [],
            })
        );

        hydrateUndoStoreFromSession([
            {
                actionType: registration.actionType,
                operationVersion: registration.operationVersion,
                role: 'forward',
                validateArguments: registration.runtimeSchema.validate,
                validateEntry: registration.sessionEntryValidator,
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);

        expect(undoStore.value?.past).toEqual([]);
    });

    it('hydrates the private restore inverse through production handler registration', () => {
        const registration = getExecutableCommandRegistration('addNotes');
        const entry = createPersistedAddNotesEntry();
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [
                    {
                        ...entry,
                        actionOperationVersion: registration.operationVersion,
                        inverseActionOperationVersion: 1,
                        redoActionOperationVersion: 1,
                    },
                ],
                future: [],
            })
        );
        clearHandlerRegistry();

        registerAllProductionHandlers();

        expect(undoStore.value?.past).toMatchObject([{ action: entry.action, inverseAction: entry.inverseAction }]);
    });
});
