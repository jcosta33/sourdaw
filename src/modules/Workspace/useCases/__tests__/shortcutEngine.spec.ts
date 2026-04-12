import { describe, it, expect, vi, afterEach } from 'vitest';
import { startShortcutEngine } from '../shortcutEngine';

const mocks = vi.hoisted(() => ({ mockEventBus: {
        emit: vi.fn(),
        on: vi.fn(),
    } }));

vi.mock('#/app/registerDependencies', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/app/registerDependencies')>();
    return {
        ...actual,
        eventBus: mocks.mockEventBus,
    };
});

describe('startShortcutEngine', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should register a keydown listener and remove it when unsubscribe runs', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const unsubscribe = startShortcutEngine();

        expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        unsubscribe();
        expect(removeSpy).toHaveBeenCalledWith('keydown', addSpy.mock.calls[0][1]);
    });
});
