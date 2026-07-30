import { describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';

const EXECUTABLE_ACTION_TYPES = [
    'addTrack',
    'renameTrack',
    'muteTrack',
    'soloTrack',
    'duplicateTrack',
    'setTrackGain',
    'setTrackPan',
    'setTrackColor',
    'reorderTrack',
    'setTempo',
    'setDeviceParameter',
    'bypassDevice',
    'addSend',
    'setSend',
    'removeSend',
    'setTrackOutput',
] as const;

describe('executable command registry', () => {
    it('derives the exact duplicate-free provider tool surface with strict arguments and explicit policy', () => {
        const schemas = getExecutableAppActionToolSchemas();
        const actionTypes = schemas.map((schema) => schema.function.name);

        expect(actionTypes).toEqual(EXECUTABLE_ACTION_TYPES);
        expect(new Set(actionTypes).size).toBe(actionTypes.length);
        expect(schemas.every((schema) => schema.function.parameters.additionalProperties === false)).toBe(true);
        expect(
            actionTypes.map((actionType) => {
                const policy = getAppActionExecutionPolicy(actionType);
                return {
                    actionType,
                    classification: policy.classification,
                    confirmationType: typeof policy.requiresConfirmation,
                };
            })
        ).toEqual(
            actionTypes.map((actionType) => ({
                actionType,
                classification: 'explicit',
                confirmationType: 'boolean',
            }))
        );
    });

    it('maps every provider-executable action to one production handler with executable metadata', () => {
        const handlers: Record<string, unknown> = {
            ...getArrangementHandlers(),
            ...getTransportHandlers(),
        };

        expect(
            getExecutableAppActionToolSchemas().map((schema) => {
                const handler = handlers[schema.function.name];
                if (typeof handler !== 'object' || handler === null) {
                    return { actionType: schema.function.name, handler: null };
                }
                return {
                    actionType: schema.function.name,
                    handler: {
                        execute: typeof Reflect.get(handler, 'execute'),
                        describe: typeof Reflect.get(handler, 'describe'),
                        undoable: typeof Reflect.get(handler, 'undoable'),
                    },
                };
            })
        ).toEqual(
            EXECUTABLE_ACTION_TYPES.map((actionType) => ({
                actionType,
                handler: { execute: 'function', describe: 'function', undoable: 'boolean' },
            }))
        );
    });
});
