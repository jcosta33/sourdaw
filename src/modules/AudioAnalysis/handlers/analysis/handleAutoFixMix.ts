import { logger } from '#/infra/logger/appLogger';
import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { createAppActionCommittedError, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { clampFaderGain } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';

import { analyzeMix } from '../../useCases/analyzeMix';
import { mixAnalysisDisplayLifecycle } from '../../useCases/mixAnalysisDisplayLifecycle';

/** Clip threshold (dBFS) used by analyzeMix to flag `isClipping`. */
const CLIP_THRESHOLD_DB = -0.5;
/** Extra headroom (dB) to leave below the clip threshold after a reduction. */
const SAFETY_MARGIN_DB = 3;
/** Fallback fader value when a track's current gain is unknown. */
const DEFAULT_TRACK_GAIN = 0.8;
/** Fallback fader value when the master fader gain is unknown. */
const DEFAULT_MASTER_GAIN = 0.8;

/**
 * Time (ms) to let the track/master gain ramps and the smoothed analysers
 * settle before re-reading levels. The gain nodes ramp via
 * `setTargetAtTime(..., 0.01)` (≈30 ms to converge) and the analysers use
 * `smoothingTimeConstant = 0.8` (≈hundreds of ms of decay), so an immediate
 * re-read reflects pre-change samples. 250 ms covers the dominant settling.
 */
const ANALYSER_SETTLE_MS = 250;

function settleDelay(ms: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, ms);
        const abort = () => {
            clearTimeout(timeout);
            reject(signal?.reason instanceof Error ? signal.reason : new Error('Mix analysis was cancelled'));
        };
        signal?.addEventListener('abort', abort, { once: true });
    });
}

export const handleAutoFixMix = createHandler<'autoFixMix'>({
    execute: async (_action, context) => {
        const token = mixAnalysisDisplayLifecycle.begin();
        if (token === null) {
            return;
        }

        let did_apply_write = false;
        try {
            const result = await analyzeMix(context?.signal);
            mixAnalysisDisplayLifecycle.complete({ token, result });

            const tracks = getTrackStoreState()?.tracks ?? [];
            // `executeAppAction` waits for the pending CRDT snapshot transaction
            // before it admits a write, and only re-checks authority *after* that
            // wait. A `throwIfAborted` before the call therefore cannot cover the
            // gap: cancelling during admission would still commit. The guard runs
            // inside that window and declines the write there.
            const admitWhileLive = { shouldExecute: () => context?.signal?.aborted !== true };
            for (const tl of result.trackLevels) {
                context?.signal?.throwIfAborted();
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
                    // Bounded by the fader law, not by unity. This is a
                    // *reduction*, so the ceiling can never be the binding
                    // constraint — but a literal `1` here is: a fader parked in
                    // the `+6 dB` headroom would be dragged down to unity
                    // instead of down by the computed amount, attenuating more
                    // than the correction asked for.
                    const newGain = clampFaderGain(currentGain * reductionFactor);
                    await executeAppAction(
                        {
                            type: 'setTrackGain',
                            payload: { trackId: tl.trackId, gain: newGain, expectedGain: currentGain },
                        },
                        admitWhileLive
                    );
                    // A declined admission returns without writing and without
                    // throwing, so re-check before recording the write as applied.
                    context?.signal?.throwIfAborted();
                    did_apply_write = true;
                }
            }

            context?.signal?.throwIfAborted();

            // The track corrections above change the master peak: attenuating a
            // clipping track lowers the sum it feeds. `result` was measured before
            // them, so deciding the master reduction from it would attenuate a
            // peak that no longer exists and land the mix far under target. The
            // gain changes ramp over time and feed smoothed analysers, so settle
            // first, then re-measure and decide from the corrected mix.
            await settleDelay(ANALYSER_SETTLE_MS, context?.signal);
            let latest = await analyzeMix(context?.signal);
            mixAnalysisDisplayLifecycle.complete({ token, result: latest });

            if (latest.overallLevel.peakDb > -3) {
                // Reduce the master fader *relative to its current fader*, not by
                // deriving an absolute gain from the measured peak. Lower the
                // fader by the amount the overall peak overshoots the safe ceiling
                // (-6 dBFS target), so the mix lands below it.
                const overshootDb = latest.overallLevel.peakDb - -6;
                const reductionFactor = 10 ** (-overshootDb / 20);
                const currentMasterPercent = getTransportState()?.masterGain;
                const currentMasterGain =
                    currentMasterPercent !== undefined ? currentMasterPercent / 100 : DEFAULT_MASTER_GAIN;
                // Same law as the track correction above: the master fader now
                // reaches `FADER_MAX_GAIN` too, so clamping the reduced value
                // at unity would over-attenuate a master sitting in headroom.
                const newMasterGain = clampFaderGain(currentMasterGain * reductionFactor);
                await executeAppAction(
                    {
                        type: 'setMasterGain',
                        // Carry the percent this reduction was derived from. Admission
                        // is asynchronous, so a fader move — local or collaborative —
                        // can land in the gap; the guard makes that conflict instead of
                        // silently overwriting the mover with a stale-derived target.
                        payload: { gain: newMasterGain, expectedPercent: currentMasterPercent },
                    },
                    admitWhileLive
                );
                context?.signal?.throwIfAborted();
                did_apply_write = true;

                // Only the master write needs a further refresh; without it `latest`
                // already reflects every correction this run made.
                await settleDelay(ANALYSER_SETTLE_MS, context?.signal);
                latest = await analyzeMix(context?.signal);
                mixAnalysisDisplayLifecycle.complete({ token, result: latest });
            }
        } catch (error) {
            // Surface the failure instead of swallowing it — a thrown analysis/fix error would
            // otherwise just stop the spinner and read as "nothing to fix". Log, then reset.
            logger.error(error instanceof Error ? error : new Error(`Auto-fix mix failed: ${String(error)}`));
            mixAnalysisDisplayLifecycle.fail({ token });
            if (did_apply_write || isAppActionCommittedError(error)) {
                throw createAppActionCommittedError({ actionType: 'autoFixMix', cause: error });
            }
            throw error;
        }
    },
    describe: () => ({ label: 'Auto-fix mix issues' }),
    undoable: false,
});
