import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '../../stores/undoStore';
import { getExecutableAppActionGroundingCatalog } from '../getExecutableAppActionGroundingCatalog';
import { getExecutableAppActionIntentCatalog } from '../getExecutableAppActionIntentCatalog';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';
import { getExecutableCommandRegistration } from '../getExecutableCommandRegistration';
import { isExecutableAppActionType } from '../executableAppActionRegistry';
import { getInternalUndoSessionReplayContracts } from '../getInternalUndoSessionReplayContracts';

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
                        pitch: { type: 'integer', minimum: 0, maximum: 127 },
                        startBeat: { type: 'number', minimum: 0 },
                        duration: { type: 'number', exclusiveMinimum: 0 },
                        velocity: { type: 'integer', minimum: 1, maximum: 127 },
                    },
                    required: ['pitch', 'startBeat', 'duration'],
                },
            },
        });
        expect(registration.runtimeSchema.validate({
            clipId: 'clip-midi',
            notes: [{ id: 'note-command-1', pitch: 60, startBeat: 0, duration: 1, velocity: 96 }],
        })).toBe(true);
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

    it('hydrates the guarded private inverse through an internal replay contract', () => {
        const registration = getExecutableCommandRegistration('addNotes');
        const action = {
            type: 'addNotes',
            payload: { clipId: 'clip-midi', notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }] },
        } as const;
        const inverseAction = {
            type: 'restoreMidiClipNotes',
            payload: { clipId: 'clip-midi', notes: [], expectedNotes: [] },
        } as const;
        sessionStorage.setItem(
            'sourdaw-undo-session',
            JSON.stringify({
                past: [
                    {
                        id: 'undo-add-note',
                        kind: 'action',
                        label: 'Add MIDI note',
                        action,
                        actionOperationVersion: registration.operationVersion,
                        inverseAction,
                        inverseActionOperationVersion: 1,
                        timestamp: 1,
                        source: 'ai',
                    },
                ],
                future: [],
            })
        );

        hydrateUndoStoreFromSession([
            {
                actionType: registration.actionType,
                operationVersion: registration.operationVersion,
                validateArguments: registration.runtimeSchema.validate,
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);

        expect(undoStore.value?.past).toMatchObject([{ action, inverseAction }]);
    });
});
