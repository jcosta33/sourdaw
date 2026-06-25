import { mixAnalysisStore } from '#/modules/AiRuntime/stores';
import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { createHandler } from '#/utils/createHandler';

import { analyzeMix } from '../../useCases/analyzeMix';

/** Clip threshold (dBFS) used by analyzeMix to flag `isClipping`. */
const CLIP_THRESHOLD_DB = -0.5;
/** Extra headroom (dB) to leave below the clip threshold after a reduction. */
const SAFETY_MARGIN_DB = 3;
/** Fallback fader value when a track's current gain is unknown. */
const DEFAULT_TRACK_GAIN = 0.8;

/**
 * Time (ms) to let the track/master gain ramps and the smoothed analysers
 * settle before re-reading levels. The gain nodes ramp via
 * `setTargetAtTime(..., 0.01)` (≈30 ms to converge) and the analysers use
 * `smoothingTimeConstant = 0.8` (≈hundreds of ms of decay), so an immediate
 * re-read reflects pre-change samples. 250 ms covers the dominant settling.
 */
const ANALYSER_SETTLE_MS = 250;

function settleDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const handleAutoFixMix = createHandler<'autoFixMix'>({
    execute: async () => {
        const state = mixAnalysisStore.value;
        if (!state) {
            return;
        }

        mixAnalysisStore.set({ ...state, isAnalyzing: true });

        try {
            const result = await analyzeMix();
            mixAnalysisStore.set({ result, isAnalyzing: false, panelOpen: true });

            const tracks = trackStore.value?.tracks ?? [];
            for (const tl of result.trackLevels) {
                if (tl.isClipping) {
                    // Reduce the track *relative to its current fader*, not by
                    // deriving an absolute gain from the measured peak. The
                    // measured peakDb is a level, not the fader position; the
                    // fader is the only thing `setTrackGain` controls. Lower the
                    // fader by the amount the peak overshoots the clip threshold,
                    // plus a safety margin, so the new peak lands below it.
                    const overshootDb = tl.peakDb - CLIP_THRESHOLD_DB;
                    const reductionFactor = 10 ** (-(overshootDb + SAFETY_MARGIN_DB) / 20);
                    const currentGain = tracks.find((time) => time.id === tl.trackId)?.gain ?? DEFAULT_TRACK_GAIN;
                    const newGain = Math.max(0, Math.min(1, currentGain * reductionFactor));
                    await executeAppAction({
                        type: 'setTrackGain',
                        payload: { trackId: tl.trackId, gain: newGain },
                    });
                }
            }

            if (result.overallLevel.peakDb > -3) {
                const reductionDb = result.overallLevel.peakDb + 6;
                const currentMasterLinear = 10 ** (result.overallLevel.peakDb / 20);
                const targetMasterLinear = currentMasterLinear / 10 ** (reductionDb / 20);
                const newMasterGain = Math.max(0, Math.min(1, targetMasterLinear));
                await executeAppAction({ type: 'setMasterGain', payload: { gain: newMasterGain } });
            }

            // The gain changes above ramp over time and feed smoothed
            // analysers, so re-reading immediately would capture pre-change
            // samples. Wait for the ramps/analysers to settle before the refresh
            // so the snapshot reflects the corrected mix.
            await settleDelay(ANALYSER_SETTLE_MS);

            const refreshed = await analyzeMix();
            mixAnalysisStore.set({ result: refreshed, isAnalyzing: false, panelOpen: true });
        } catch {
            mixAnalysisStore.set({ ...state, isAnalyzing: false });
        }
    },
    describe: () => ({ label: 'Auto-fix mix issues' }),
    undoable: false,
});
