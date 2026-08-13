import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry } from '#/modules/Command/stores';
import { getExecutableCommandRegistrations, registerProductionCommandHandlers } from '#/modules/Command/useCases';

import { getProductionCommandHandlerMaps } from '../getProductionCommandHandlerMaps';

function handlerCanJoinBatch(handler: unknown): boolean {
    if (typeof handler !== 'object' || handler === null) {
        return false;
    }
    const candidate = handler as Record<string, unknown>;
    return (
        candidate.batchExecution === 'singleton' ||
        (candidate.batchRestriction === undefined && typeof candidate.validate === 'function')
    );
}

describe('getProductionCommandHandlerMaps', () => {
    beforeEach(() => {
        clearHandlerRegistry();
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('assembles the complete duplicate-free production handler set before canonical validation', () => {
        const handlerMaps = getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true });
        const actionTypes = handlerMaps.flatMap((handlerMap) => Object.keys(handlerMap));
        const allHandlers = handlerMaps.flatMap((handlerMap) =>
            Object.entries(handlerMap).map(([actionType, handler]) => ({ actionType, handler: handler as unknown }))
        );

        expect(handlerMaps).toHaveLength(34);
        expect(new Set(actionTypes).size).toBe(actionTypes.length);
        expect(
            allHandlers.filter(({ handler }) => !handlerCanJoinBatch(handler)).map(({ actionType }) => actionType)
        ).toEqual([]);

        registerProductionCommandHandlers(handlerMaps);

        const registrations = getExecutableCommandRegistrations();
        expect(registrations).toHaveLength(97);
        expect(registrations.every((registration) => typeof registration.handler.execute === 'function')).toBe(true);
        expect(
            registrations
                .filter(
                    ({ handler }) =>
                        handler.batchExecution !== 'singleton' &&
                        (handler.batchRestriction !== undefined || typeof handler.validate !== 'function')
                )
                .map(({ actionType }) => actionType)
        ).toEqual([]);
        expect(
            registrations.every(
                ({ handler }) =>
                    handler.batchRestriction !== 'missing-validation' || handler.batchExecution === 'singleton'
            )
        ).toBe(true);
    });
});
