import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { finishToolSwap } from '#/modules/WorkspaceShell/useCases';

import { handleKeyup } from '../handleKeyup';

const eventBus = { emit: vi.fn(), on: vi.fn(() => () => undefined) };

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    finishToolSwap: vi.fn(),
}));

describe('handleKeyup', () => {
    beforeEach(() => {
        injectDependencies(handleKeyup, { eventBus });
        vi.clearAllMocks();
    });

    it('does not synthesize a voice admission on releasing v', () => {
        handleKeyup('v');

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('asks Workspace to finish any matching tool swap for the released key', () => {
        const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(2345);

        handleKeyup('b');

        expect(finishToolSwap).toHaveBeenCalledWith({
            key: 'b',
            timestamp: 2345,
        });

        performanceNow.mockRestore();
    });
});
