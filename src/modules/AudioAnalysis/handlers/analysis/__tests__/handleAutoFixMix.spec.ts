import { describe, it, expect, vi, beforeEach } from 'vitest';

import { analyzeMix } from '../../../useCases/analyzeMix';
import { handleAutoFixMix } from '../handleAutoFixMix';

const mocks = vi.hoisted(() => ({
    storeValue: null as unknown,
    storeSet: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    mixAnalysisStore: {
        get value() {
            return mocks.storeValue;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('../../../useCases/analyzeMix', () => ({
    analyzeMix: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

describe('handleAutoFixMix', () => {
    beforeEach(() => {
        mocks.storeValue = null;
        mocks.storeSet.mockReset();
        mocks.executeAppAction.mockReset();
        vi.mocked(analyzeMix).mockReset();
    });

    it('should do nothing if store state is missing', async () => {
        mocks.storeValue = null;
        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('should set analyzing state and call analyzeMix', async () => {
        mocks.storeValue = { isAnalyzing: false };
        vi.mocked(analyzeMix).mockResolvedValue({
            trackLevels: [],
            overallLevel: { peakDb: -10 },
        } as any);

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ isAnalyzing: true }));
        expect(analyzeMix).toHaveBeenCalled();
        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ isAnalyzing: false, panelOpen: true }));
    });

    it('should fix clipping tracks and master gain', async () => {
        mocks.storeValue = { isAnalyzing: false };

        vi.mocked(analyzeMix).mockResolvedValueOnce({
            trackLevels: [{ trackId: 't1', isClipping: true, peakDb: 2 }],
            overallLevel: { peakDb: -1 },
        } as any);

        vi.mocked(analyzeMix).mockResolvedValueOnce({
            trackLevels: [{ trackId: 't1', isClipping: false, peakDb: -6 }],
            overallLevel: { peakDb: -10 },
        } as any);

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'setTrackGain',
                payload: expect.objectContaining({ trackId: 't1' }),
            })
        );

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'setMasterGain',
            })
        );
    });

    it('should reset analyzing state on error', async () => {
        mocks.storeValue = { isAnalyzing: false };
        vi.mocked(analyzeMix).mockRejectedValue(new Error('crash'));

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        expect(mocks.storeSet).toHaveBeenLastCalledWith(expect.objectContaining({ isAnalyzing: false }));
    });
});
