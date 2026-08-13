import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry } from '#/modules/Command/stores';
import { getExecutableCommandRegistrations, registerProductionCommandHandlers } from '#/modules/Command/useCases';

import { getProductionCommandHandlerMaps } from '../getProductionCommandHandlerMaps';

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

        expect(handlerMaps).toHaveLength(34);
        expect(new Set(actionTypes).size).toBe(actionTypes.length);

        registerProductionCommandHandlers(handlerMaps);

        const registrations = getExecutableCommandRegistrations();
        expect(registrations).toHaveLength(97);
        expect(registrations.every((registration) => typeof registration.handler.execute === 'function')).toBe(true);
    });
});
