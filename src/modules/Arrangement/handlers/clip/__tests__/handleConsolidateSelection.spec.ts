import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ActionExecutionContext } from '#/utils/handlerContract';

import { handleConsolidateSelection } from '../handleConsolidateSelection';

const mocks = vi.hoisted(() => ({
    bounceSelection: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/bounceSelection', () => ({
    bounceSelection: mocks.bounceSelection,
}));

describe('handleConsolidateSelection', () => {
    const context: ActionExecutionContext = {
        executeAppAction: vi.fn(),
        runCommandTransition: vi.fn(),
        runLegacyCommandMutation: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bounceSelection with the provided payload', async () => {
        await handleConsolidateSelection.execute(
            {
                type: 'consolidateSelection',
                payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
            },
            context
        );

        expect(mocks.bounceSelection).toHaveBeenCalledWith('t1', 0, 4, context.runLegacyCommandMutation);
    });

    it('provides a description', () => {
        const desc = handleConsolidateSelection.describe({
            type: 'consolidateSelection',
            payload: { trackId: 't1', startBeat: 0, endBeat: 4 },
        });
        expect(desc.label).toBe('Consolidate selection');
    });

    it('is undoable', () => {
        expect(handleConsolidateSelection.undoable).toBe(true);
    });
});
