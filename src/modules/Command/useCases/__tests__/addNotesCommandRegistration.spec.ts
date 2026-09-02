import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '../../stores/undoStore';
import { isExecutableAppActionType } from '../executableAppActionRegistry';
import { getExecutableAppActionGroundingCatalog } from '../getExecutableAppActionGroundingCatalog';
import { getExecutableAppActionIntentCatalog } from '../getExecutableAppActionIntentCatalog';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';
import { getExecutableCommandRegistration } from '../getExecutableCommandRegistration';
import { getInternalUndoSessionReplayContracts } from '../getInternalUndoSessionReplayContracts';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';

function createPersistedAddNotesEntry() {
    const noteTransformReplayGuard = {
        trackId: 'track-midi',
        expectedTrackFrozen: false,
        expectedClipLocked: false,
    };
    const notes = [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, probability: 100 }];
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
            payload: { clipId: 'clip-midi', notes: [], expectedNotes: notes, noteTransformReplayGuard },
        },
        redoAction: {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'clip-midi',
                notes,
                expectedNotes: [],
                noteTransformReplayGuard,
            },
        },
        timestamp: 1,
        source: 'ai',
    };
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

    it('hydrates only an exact addNotes restore pair through the private replay contract', () => {
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

        expect(undoStore.value?.past).toMatchObject([entry]);
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
                const mismatchedNotes = [{ ...entry.inverseAction.payload.expectedNotes[0]!, pitch: 61 }];
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
            'duplicate materialized ids',
            () => {
                const entry = createPersistedAddNotesEntry();
                const duplicatedNotes = [
                    ...entry.inverseAction.payload.expectedNotes,
                    entry.inverseAction.payload.expectedNotes[0]!,
                ];
                return {
                    ...entry,
                    action: {
                        ...entry.action,
                        payload: {
                            ...entry.action.payload,
                            notes: [...entry.action.payload.notes, { ...entry.action.payload.notes[0]! }],
                        },
                    },
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, expectedNotes: duplicatedNotes },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: duplicatedNotes },
                    },
                };
            },
        ],
        [
            'a materialized id that collides with the pre-add snapshot',
            () => {
                const entry = createPersistedAddNotesEntry();
                const baseNotes = [{ id: 'note-1', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }];
                const expectedNotes = [...baseNotes, ...entry.inverseAction.payload.expectedNotes];
                return {
                    ...entry,
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, notes: baseNotes, expectedNotes },
                    },
                    redoAction: {
                        ...entry.redoAction,
                        payload: { ...entry.redoAction.payload, notes: expectedNotes, expectedNotes: baseNotes },
                    },
                };
            },
        ],
        [
            'missing materialized ids',
            () => {
                const entry = createPersistedAddNotesEntry();
                return {
                    ...entry,
                    action: {
                        ...entry.action,
                        payload: {
                            ...entry.action.payload,
                            notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
                        },
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
        const tamperedRedoNotes = [{ ...entry.redoAction.payload.notes[0]!, [field]: value }];
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [],
                future: [
                    {
                        ...entry,
                        redoAction: {
                            ...entry.redoAction,
                            payload: { ...entry.redoAction.payload, notes: tamperedRedoNotes },
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
        const nonCanonicalNote = { ...entry.action.payload.notes[0]!, probability: 99 };
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [],
                future: [
                    {
                        ...entry,
                        action: { ...entry.action, payload: { ...entry.action.payload, notes: [nonCanonicalNote] } },
                        inverseAction: {
                            ...entry.inverseAction,
                            payload: { ...entry.inverseAction.payload, expectedNotes: [nonCanonicalNote] },
                        },
                        redoAction: {
                            ...entry.redoAction,
                            payload: { ...entry.redoAction.payload, notes: [nonCanonicalNote] },
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

        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
        ]);

        expect(undoStore.value?.past).toMatchObject([{ action: entry.action, inverseAction: entry.inverseAction }]);
    });
});
