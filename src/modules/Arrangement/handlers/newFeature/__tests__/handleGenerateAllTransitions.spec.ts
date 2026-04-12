import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGenerateAllTransitions } from '../handleGenerateAllTransitions';

const mocks = vi.hoisted(() => ({
    generateAllTransitionFills: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/fillTransitionGeneration/generation', () => ({
    generateAllTransitionFills: mocks.generateAllTransitionFills,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleGenerateAllTransitions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes generateAllTransitionFills and notifies success if fills are generated', () => {
        mocks.generateAllTransitionFills.mockReturnValue([{}, {}]);

        handleGenerateAllTransitions.execute({ type: 'generateAllTransitions', payload: {} });

        expect(mocks.generateAllTransitionFills).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Generated 2 transition fills across arrangement', 'success');
    });

    it('notifies warning if no fills are generated', () => {
        mocks.generateAllTransitionFills.mockReturnValue([]);

        handleGenerateAllTransitions.execute({ type: 'generateAllTransitions', payload: {} });

        expect(mocks.notifyUser).toHaveBeenCalledWith('No section boundaries found — add sections first', 'warning');
    });

    it('provides a description', () => {
        const desc = handleGenerateAllTransitions.describe({ type: 'generateAllTransitions', payload: {} });
        expect(desc.label).toBe('Generate All Transitions');
    });

    it('is undoable', () => {
        expect(handleGenerateAllTransitions.undoable).toBe(true);
    });
});
