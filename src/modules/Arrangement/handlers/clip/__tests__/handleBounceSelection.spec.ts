import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ActionExecutionContext } from '#/utils/handlerContract';

import { handleBounceSelection } from '../handleBounceSelection';

const mocks = vi.hoisted(() => ({
    bounceSelection: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/bounceSelection', () => ({
    bounceSelection: mocks.bounceSelection,
}));

describe('handleBounceSelection', () => {
    const context: ActionExecutionContext = {
        executeAppAction: vi.fn(),
        runCommandTransition: vi.fn(),
        runLegacyCommandMutation: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceSelection with the provided payload', () => {
        void handleBounceSelection.execute(
            {
                type: 'bounceSelection',
                payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
            },
            context
        );

        expect(mocks.bounceSelection).toHaveBeenCalledWith('t1', 0, 4, context.runLegacyCommandMutation);
    });

    it('provides a description', () => {
        const desc = handleBounceSelection.describe({
            type: 'bounceSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });
        expect(desc.label).toBe('Bounce selection to audio');
    });

    it('is undoable', () => {
        expect(handleBounceSelection.undoable).toBe(true);
    });
});
