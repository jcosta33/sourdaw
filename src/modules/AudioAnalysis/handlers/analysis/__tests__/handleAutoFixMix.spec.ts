import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { analyzeMix } from '../../../useCases/analyzeMix';
import { handleAutoFixMix } from '../handleAutoFixMix';

const mocks = vi.hoisted(() => ({
    storeValue: null as unknown,
    storeSet: vi.fn(),
    executeAppAction: vi.fn(),
    trackStore: { value: null as { tracks: unknown[] } | null },
    loggerError: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    mixAnalysisStore: {
        get value() {
            return mocks.storeValue;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
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
        mocks.trackStore.value = null;
        mocks.loggerError.mockReset();
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
        mocks.trackStore.value = { tracks: [{ id: 't1', gain: 0.8 }] };

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

    it('should reduce a clipping track relative to its current fader, not from the measured peak alone', async () => {
        // Two tracks with the *same* measured peak but different current faders.
        // The fix computes a relative reduction (same dB factor) applied to each
        // fader, so the louder fader ends up proportionally louder. The old code
        // derived an absolute gain from peakDb alone, giving both tracks the
        // identical result regardless of fader.
        mocks.storeValue = { isAnalyzing: false };
        mocks.trackStore.value = {
            tracks: [
                { id: 'loud', gain: 0.9 },
                { id: 'quiet', gain: 0.3 },
            ],
        };

        vi.mocked(analyzeMix).mockResolvedValueOnce({
            trackLevels: [
                { trackId: 'loud', isClipping: true, peakDb: 2 },
                { trackId: 'quiet', isClipping: true, peakDb: 2 },
            ],
            overallLevel: { peakDb: -10 },
        } as any);
        vi.mocked(analyzeMix).mockResolvedValueOnce({
            trackLevels: [],
            overallLevel: { peakDb: -10 },
        } as any);

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        const gainCalls = mocks.executeAppAction.mock.calls
            .map(([action]) => action)
            .filter((action) => action.type === 'setTrackGain');
        const loud = gainCalls.find((action) => action.payload.trackId === 'loud');
        const quiet = gainCalls.find((action) => action.payload.trackId === 'quiet');

        expect(loud).toBeDefined();
        expect(quiet).toBeDefined();

        // Same overshoot -> same reduction factor; applied to each current fader.
        const overshootDb = 2 - -0.5; // peak - clip threshold
        const factor = 10 ** (-(overshootDb + 3) / 20);
        expect(loud!.payload.gain).toBeCloseTo(0.9 * factor, 6);
        expect(quiet!.payload.gain).toBeCloseTo(0.3 * factor, 6);
        // The two faders must NOT collapse to one value (the old peak-derived bug).
        expect(loud!.payload.gain).not.toBeCloseTo(quiet!.payload.gain, 6);
        expect(loud!.payload.gain).toBeGreaterThan(quiet!.payload.gain);
    });

    it('should refresh the analysis only after waiting for the analyser to settle', async () => {
        vi.useFakeTimers();
        try {
            mocks.storeValue = { isAnalyzing: false };
            mocks.trackStore.value = { tracks: [{ id: 't1', gain: 0.8 }] };

            vi.mocked(analyzeMix)
                .mockResolvedValueOnce({
                    trackLevels: [{ trackId: 't1', isClipping: true, peakDb: 2 }],
                    overallLevel: { peakDb: -10 },
                } as any)
                .mockResolvedValueOnce({
                    trackLevels: [],
                    overallLevel: { peakDb: -10 },
                } as any);

            const done = handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

            // Let the initial analyze + gain dispatches flush, but do NOT advance
            // wall-clock time yet. The refresh must be gated behind the settle
            // delay, so analyzeMix has been called exactly once so far.
            await vi.advanceTimersByTimeAsync(0);
            expect(analyzeMix).toHaveBeenCalledTimes(1);

            // Advancing past the settle window releases the refresh.
            await vi.advanceTimersByTimeAsync(250);
            await done;
            expect(analyzeMix).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should log the error and reset analyzing state on error', async () => {
        mocks.storeValue = { isAnalyzing: false };
        const failure = new Error('crash');
        vi.mocked(analyzeMix).mockRejectedValue(failure);

        await handleAutoFixMix.execute({ type: 'autoFixMix', payload: {} });

        expect(mocks.loggerError).toHaveBeenCalledWith(failure);
        expect(mocks.storeSet).toHaveBeenLastCalledWith(expect.objectContaining({ isAnalyzing: false }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});
