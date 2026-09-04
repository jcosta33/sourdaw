/**
 * The audio window a clip actually plays, as one shared law for both timeline
 * renderers (Canvas2D `clipDrawing.ts` and WebGPU `createWebGpuRenderer.ts`),
 * so the waveform a musician aligns by eye is the material that sounds.
 */

/**
 * The draw path's own stretch floor. The playback runtimes bound the ratio
 * through `boundStretchRatio` ([0.01, 100], #2532); the renderers keep their
 * historical floor, and changing it here would redraw every clip whose stored
 * ratio falls between the two laws. Not part of this span's contract.
 */
const DRAW_STRETCH_FLOOR = 0.0001;

export type AudioWaveformDrawSpan = {
    /** Source sample the audible material starts at (0 under a negative offset). */
    startSample: number;
    /** Source sample the audible material ends at. */
    endSample: number;
    /**
     * Timeline beats of silence at the clip's head, before the first audible
     * sample. Zero unless the offset is negative.
     */
    leadingSilenceBeats: number;
    /**
     * Timeline beats during which source material sounds. At or below zero the
     * pre-roll swallowed the whole clip and nothing is audible to draw.
     */
    audibleTimelineBeats: number;
};

/**
 * Map a clip's beats onto source samples, mirroring the live scheduler's
 * negative-offset semantics (`scheduleAudioClips`).
 *
 * A negative offset puts the clip's head before the source's sample 0: the
 * head is silent until the source would have reached its own start, and the
 * material then plays from sample 0 for the shortened remainder — the
 * iteration still ends where the clip says it does, so the pre-roll shortens
 * what is heard rather than moving the tail. The pre-roll is measured exactly
 * as the scheduler plays it (`preRollSeconds = max(0, -offsetSeconds) /
 * stretchRatio`): the offset span is source time, and crossing it at the
 * clip's playback rate costs `span / rate` of the timeline.
 *
 * The audible span consumes `timelineBeats * ratio` of source, matching the
 * scheduler's `playbackRate = stretchRatio` (source consumed over destination
 * time T is T * stretchRatio). Fit-to-beats stores ratio 0.5 when stretching
 * 4 beats of material across 8 destination beats, so the draw shows 4 source
 * beats over those 8.
 *
 * Pure: both renderers must derive identical spans from identical inputs.
 */
export function computeAudioWaveformDrawSpan({
    offsetBeats,
    stretchRatio,
    clipBeats,
    secondsPerBeat,
    sampleRate,
}: {
    offsetBeats: number;
    stretchRatio: number;
    clipBeats: number;
    secondsPerBeat: number;
    sampleRate: number;
}): AudioWaveformDrawSpan {
    const ratio = Math.max(stretchRatio, DRAW_STRETCH_FLOOR);
    const leadingSilenceBeats = Math.max(0, -offsetBeats) / ratio;
    const audibleTimelineBeats = clipBeats - leadingSilenceBeats;
    const startSample = Math.max(0, Math.floor(offsetBeats * secondsPerBeat * sampleRate));
    const beatsConsumed = audibleTimelineBeats * ratio;
    const endSample = Math.floor(startSample + beatsConsumed * secondsPerBeat * sampleRate);
    return { startSample, endSample, leadingSilenceBeats, audibleTimelineBeats };
}
