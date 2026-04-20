import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCompareToReference } from '../handleCompareToReference';

const mocks = vi.hoisted(() => ({
    compareToReference: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    compareToReference: mocks.compareToReference,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleCompareToReference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes compareToReference and notifies success if score >= 70', () => {
        mocks.compareToReference.mockReturnValue({
            overallScore: 85,
            suggestions: ['Good job'],
        });

        void handleCompareToReference.execute({ type: 'compareToReference', payload: {} });

        expect(mocks.compareToReference).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Mix comparison: 85% match — 1 suggestions', 'success');
    });

    it('executes compareToReference and notifies warning if score < 70', () => {
        mocks.compareToReference.mockReturnValue({
            overallScore: 65,
            suggestions: ['Needs more bass', 'Too loud'],
        });

        void handleCompareToReference.execute({ type: 'compareToReference', payload: {} });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Mix comparison: 65% match — 2 suggestions', 'warning');
    });

    it('provides a description', () => {
        const desc = handleCompareToReference.describe({ type: 'compareToReference', payload: {} });
        expect(desc.label).toBe('Compare to Reference Mix');
    });

    it('is not undoable', () => {
        expect(handleCompareToReference.undoable).toBe(false);
    });
});
