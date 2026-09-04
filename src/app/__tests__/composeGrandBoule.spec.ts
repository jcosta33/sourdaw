import { describe, it, expect, vi } from 'vitest';

import { setGrandBouleEventBus, initGrandBouleSubscribers } from '#/modules/GrandBoule/useCases';

import { composeGrandBoule } from '../composeGrandBoule';

// bootstrap.spec.ts mocks this whole module away, so no spec ever executes
// composeGrandBoule's own body. Mock its two dependencies instead and assert
// directly on the wiring it performs — see #3089.
vi.mock('#/modules/GrandBoule/useCases', () => ({
    setGrandBouleEventBus: vi.fn(),
    initGrandBouleSubscribers: vi.fn(),
}));

const eventBusMock = { emit: vi.fn(), on: vi.fn() };
const loggerMock = { info: vi.fn() };

describe('composeGrandBoule', () => {
    it('binds the shared event bus and starts the audioDevice.loaded subscriber', () => {
        composeGrandBoule({ eventBus: eventBusMock, logger: loggerMock });

        expect(setGrandBouleEventBus).toHaveBeenCalledExactlyOnceWith(eventBusMock);
        expect(initGrandBouleSubscribers).toHaveBeenCalledExactlyOnceWith({
            eventBus: eventBusMock,
            logger: loggerMock,
        });
    });
});
