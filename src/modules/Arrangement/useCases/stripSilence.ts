import { prepareStripSilence } from './prepareStripSilence';
import { restoreStripSilenceState } from './restoreStripSilenceState';

/**
 * Split a clip into regions separated by silence.
 * Silent gaps shorter than `minSilenceBeats` are merged with their adjacent
 * sound regions so that short inter-word pauses don't cut the clip.
 *
 * Thin orchestrator over `prepareStripSilence` (compute the before/after
 * snapshot, including the clip-satellite transition) and
 * `restoreStripSilenceState` (validate and publish it) — the same shape as
 * `glueClips`/`prepareClipGlue`/`restoreClipGlueState` so both operations
 * share one undo idiom.
 */
export function stripSilence(clipId: string, thresholdDb: number = -40, minSilenceBeats: number = 0.5): boolean {
    const plan = prepareStripSilence({ clipId, threshold: thresholdDb, minDuration: minSilenceBeats });
    return plan ? restoreStripSilenceState({ expected: plan.previous, replacement: plan.next }) : false;
}
