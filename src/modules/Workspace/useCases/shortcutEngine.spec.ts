import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startShortcutEngine } from './shortcutEngine';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('startShortcutEngine', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should register a keydown listener and remove it when unsubscribe runs', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const eventBus = createMock<EventBusShape>();
        injectDependencies(startShortcutEngine, { eventBus });

        const unsubscribe = startShortcutEngine();

        expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        unsubscribe();
        expect(removeSpy).toHaveBeenCalledWith('keydown', addSpy.mock.calls[0][1]);
    });
});
