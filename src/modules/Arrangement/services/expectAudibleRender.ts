import { type Clip } from '../models/Track';

/**
 * Why a render is allowed to come back silent. Each value names a decision the
 * user (or the project) made, not a failure — so a silent buffer carrying one
 * of these reasons must never be refused.
 */
export type LegitimateSilenceReason =
    /** The track is muted, or another track's solo is gating it. */
    | 'silenced-in-mix'
    /** The render bakes this track's fader and that fader is at zero. */
    | 'fader-zeroed'
    /** Nothing on this track can put a sample into the rendered range. */
    | 'no-audible-clip-content';

export type ExpectAudibleRenderOutput =
    { expectsAudio: true } | { expectsAudio: false; reason: LegitimateSilenceReason };

export type ExpectAudibleRenderInput = {
    clips: readonly Clip[];
    /** Beat range the render covers; clips outside it are never scheduled. */
    startBeat: number;
    endBeat: number;
    /**
     * The track is silenced in the mix — by its own mute button or by another
     * track's solo. Callers derive this from `deriveEffectiveAudibility`, the
     * one authoritative mute ∪ solo planner, rather than re-deriving solo here.
     */
    silencedInMix: boolean;
    /**
     * The fader value this render actually bakes into the samples.
     *
     * Not simply `track.gain`: freeze prints the target at unity because the
     * buffer is replayed *through* that same fader (`targetMixer: 'keepLive'`
     * in `projectStripTrack`), so a track sitting at -inf still has to print
     * audibly. Only a render that bakes the fader can be silenced by it.
     */
    bakedFaderGain: number;
    /** Whether the MIDI store holds at least one note for this clip id. */
    hasMidiNotes: (clipId: string) => boolean;
    /** Whether this audio clip's sample data is resolvable at render time. */
    hasAudioSamples: (clip: Clip) => boolean;
};

/**
 * Whether one clip can put a sample into the render.
 *
 * Every rejection below mirrors a `continue` in
 * `AudioEngine/useCases/offlineRender/scheduleTrackClips`, which is what
 * actually decides whether a clip reaches the graph. Anything this returns
 * false for is skipped there, so the resulting silence is the render working.
 */
function contributesSamples({
    clip,
    startBeat,
    endBeat,
    hasMidiNotes,
    hasAudioSamples,
}: {
    clip: Clip;
    startBeat: number;
    endBeat: number;
    hasMidiNotes: (clipId: string) => boolean;
    hasAudioSamples: (clip: Clip) => boolean;
}): boolean {
    if (clip.muted) {
        return false;
    }
    if (clip.endBeat <= clip.startBeat) {
        return false;
    }
    if (clip.endBeat <= startBeat || clip.startBeat >= endBeat) {
        return false;
    }

    if (clip.type === 'midi') {
        return hasMidiNotes(clip.id);
    }

    // Clip gain is read only on the audio branch of the scheduler — it seeds the
    // per-clip fade gain node — so a zeroed MIDI clip gain silences nothing and
    // must not be treated as intent.
    if (clip.gain <= 0) {
        return false;
    }
    return hasAudioSamples(clip);
}

/**
 * Should this track's offline render have produced sound?
 *
 * Answering "no" is what keeps the silence guard off legitimate silence: a
 * muted track, a fader the user pulled to zero, an empty track, a track whose
 * clips lie outside the rendered range, a MIDI clip with no notes, an audio
 * clip with no sample data. Answering "yes" means every reason the render had
 * to be quiet has been ruled out, so a silent buffer is a defect.
 */
export function expectAudibleRender({
    clips,
    startBeat,
    endBeat,
    silencedInMix,
    bakedFaderGain,
    hasMidiNotes,
    hasAudioSamples,
}: ExpectAudibleRenderInput): ExpectAudibleRenderOutput {
    if (silencedInMix) {
        return { expectsAudio: false, reason: 'silenced-in-mix' };
    }
    if (Number.isNaN(bakedFaderGain) || bakedFaderGain <= 0) {
        return { expectsAudio: false, reason: 'fader-zeroed' };
    }

    const anyClipContributes = clips.some((clip) =>
        contributesSamples({ clip, startBeat, endBeat, hasMidiNotes, hasAudioSamples })
    );
    if (!anyClipContributes) {
        return { expectsAudio: false, reason: 'no-audible-clip-content' };
    }

    return { expectsAudio: true };
}
