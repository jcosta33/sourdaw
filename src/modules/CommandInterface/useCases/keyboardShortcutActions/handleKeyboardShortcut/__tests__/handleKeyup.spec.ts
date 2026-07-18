import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { finishToolSwap } from '#/modules/Workspace/useCases';

import { handleKeyup } from '../handleKeyup';

const eventBus = { emit: vi.fn(), on: vi.fn(() => () => undefined) };

vi.mock('#/modules/Workspace/useCases', () => ({
    finishToolSwap: vi.fn(),
}));

describe('handleKeyup', () => {
    beforeEach(() => {
        injectDependencies(handleKeyup, { eventBus });
        vi.clearAllMocks();
    });

    it('emits voice.toggle inactive on releasing v', () => {
        handleKeyup('v');

        expect(eventBus.emit).toHaveBeenCalledWith('voice.toggle', { active: false });
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
