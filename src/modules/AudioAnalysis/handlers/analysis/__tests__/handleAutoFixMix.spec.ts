import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getMixAnalysisStoreValue, setMixAnalysisStoreValue } from '#/modules/AiRuntime/useCases';

import { analyzeMix } from '../../../useCases/analyzeMix';
import { handleAutoFixMix } from '../handleAutoFixMix';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    getMixAnalysisStoreValue: vi.fn(),
    setMixAnalysisStoreValue: vi.fn(),
}));

vi.mock('../../../useCases/analyzeMix', () => ({
    analyzeMix: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

describe('handleAutoFixMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should do nothing if store state is missing', async () => {
        vi.mocked(getMixAnalysisStoreValue).mockReturnValue(null as any);
        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });
        expect(setMixAnalysisStoreValue).not.toHaveBeenCalled();
    });

    it('should set analyzing state and call analyzeMix', async () => {
        const initialState = { isAnalyzing: false };
        vi.mocked(getMixAnalysisStoreValue).mockReturnValue(initialState as any);
        vi.mocked(analyzeMix).mockResolvedValue({
            trackLevels: [],
            overallLevel: { peakDb: -10 },
        } as any);

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        expect(setMixAnalysisStoreValue).toHaveBeenCalledWith(expect.objectContaining({ isAnalyzing: true }));
        expect(analyzeMix).toHaveBeenCalled();
        expect(setMixAnalysisStoreValue).toHaveBeenCalledWith(
            expect.objectContaining({ isAnalyzing: false, panelOpen: true })
        );
    });

    it('should fix clipping tracks and master gain', async () => {
        const initialState = { isAnalyzing: false };
        vi.mocked(getMixAnalysisStoreValue).mockReturnValue(initialState as any);

        // Track 1 is clipping at +2dB
        // Master is peaking at -1dB (should be reduced because > -3)
        vi.mocked(analyzeMix).mockResolvedValueOnce({
            trackLevels: [{ trackId: 't1', isClipping: true, peakDb: 2 }],
            overallLevel: { peakDb: -1 },
        } as any);

        // Refresh call returns clean state
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
        const initialState = { isAnalyzing: false };
        vi.mocked(getMixAnalysisStoreValue).mockReturnValue(initialState as any);
        vi.mocked(analyzeMix).mockRejectedValue(new Error('crash'));

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        expect(setMixAnalysisStoreValue).toHaveBeenLastCalledWith(expect.objectContaining({ isAnalyzing: false }));
    });
});
