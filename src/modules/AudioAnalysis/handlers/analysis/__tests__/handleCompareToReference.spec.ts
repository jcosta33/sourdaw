import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCompareToReference } from '../handleCompareToReference';

const mocks = vi.hoisted(() => ({
    compareToReference: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/referenceMixComparison/compareToReference', () => ({
    compareToReference: mocks.compareToReference,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleCompareToReference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should execute compareToReference and notify success if score is high enough', () => {
        mocks.compareToReference.mockReturnValue({
            overallScore: 84,
            suggestions: [{ message: 'Nice balance' }],
        });

        void handleCompareToReference.execute({ type: 'compareToReference', payload: undefined });

        expect(mocks.compareToReference).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Mix comparison: 84% match — 1 suggestions', 'success');
    });

    it('should execute compareToReference and notify warning if score is low', () => {
        mocks.compareToReference.mockReturnValue({
            overallScore: 62,
            suggestions: [{ message: 'Too dark' }, { message: 'Low vocal' }],
        });

        void handleCompareToReference.execute({ type: 'compareToReference', payload: undefined });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Mix comparison: 62% match — 2 suggestions', 'warning');
    });

    it('should provide a description', () => {
        const description = handleCompareToReference.describe({ type: 'compareToReference', payload: undefined });

        expect(description.label).toBe('Compare to Reference Mix');
    });

    it('should not be undoable', () => {
        expect(handleCompareToReference.undoable).toBe(false);
    });
});
