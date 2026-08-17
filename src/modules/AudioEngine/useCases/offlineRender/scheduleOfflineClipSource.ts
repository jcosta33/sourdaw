/**
 * Start one piece of source material, with the level envelope that keeps its
 * edges from clicking.
 *
 * Lifted verbatim out of `scheduleTrackClips`, which is still its only caller
 * on the export path, so that the offline `AudioGraphBackend` implements the
 * contract's clip command with the same body rather than a second one written
 * to match it. Nothing about the law changed in the move: the arithmetic below
 * is the arithmetic that was inline, and the two branch conditions the caller
 * used to evaluate — "is this the first iteration, untrimmed" and "is this the
 * last" — became the presence of {@link OfflineClipFadeIn} and
 * {@link OfflineClipFadeOut}.
 */

export type OfflineClipFadeIn = {
    /**
     * Absolute destination time at which the *user's* fade reaches full level,
     * when the clip carries one. Absent means the clip has no fade in and only
     * the anti-click micro-fade applies.
     */
    userEndSec?: number;
};

export type OfflineClipFadeOut = {
    /**
     * Absolute destination time at which the *user's* fade begins, when the
     * clip carries one. Absent means only the anti-click micro-fade applies.
     */
    userStartSec?: number;
};

export type ScheduleOfflineClipSourceInput = {
    context: BaseAudioContext;
    /** Where the faded source lands — a track strip's input, in the export. */
    destinationNode: AudioNode;
    buffer: AudioBuffer;
    /** Destination-timeline second at which the first frame is heard. */
    startSec: number;
    /** Where playback enters the source material, in source seconds. */
    bufferOffsetSec: number;
    /** How long the clip sounds, measured on the destination timeline. */
    playDuration: number;
    /**
     * Source frames consumed per destination frame. Left off the node entirely
     * at `1`, because assigning it is not free and the default already is one.
     */
    playbackRate: number;
    /** The clip's own level, as a linear amplitude. */
    clipGainValue: number;
    /**
     * Absent when this playback continues an unbroken sound — a loop iteration
     * that follows the previous one, or one entered part-way by a region trim.
     * Re-fading at that seam would be an audible dip, not an anti-click.
     */
    fadeIn?: OfflineClipFadeIn;
    /** Absent when the sound continues past this playback. */
    fadeOut?: OfflineClipFadeOut;
    /**
     * The anti-click floor. Applied whether or not the user asked for a fade,
     * and also the minimum a user's own fade is held to: a buffer started or
     * stopped on a non-zero sample steps the output.
     */
    microFadeSeconds: number;
};

export function scheduleOfflineClipSource(input: ScheduleOfflineClipSourceInput): AudioBufferSourceNode {
    const {
        context,
        destinationNode,
        buffer,
        startSec,
        bufferOffsetSec,
        playDuration,
        playbackRate,
        clipGainValue,
        fadeIn,
        fadeOut,
        microFadeSeconds,
    } = input;

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (playbackRate !== 1) {
        source.playbackRate.value = playbackRate;
    }

    const endSec = startSec + playDuration;

    const fadeGain = context.createGain();
    source.connect(fadeGain);
    fadeGain.connect(destinationNode);

    fadeGain.gain.setValueAtTime(clipGainValue, startSec);

    if (fadeIn) {
        if (fadeIn.userEndSec !== undefined) {
            // A user fade never runs shorter than the anti-click floor and
            // never eats more than half the audible span, so a fade longer
            // than the clip cannot swallow it.
            const fadeInDuration = Math.min(
                Math.max(microFadeSeconds, fadeIn.userEndSec - startSec),
                playDuration * 0.5
            );
            fadeGain.gain.setValueAtTime(0, startSec);
            fadeGain.gain.linearRampToValueAtTime(clipGainValue, startSec + fadeInDuration);
        } else {
            fadeGain.gain.setValueAtTime(0, startSec);
            fadeGain.gain.linearRampToValueAtTime(clipGainValue, startSec + microFadeSeconds);
        }
    }

    if (fadeOut) {
        if (fadeOut.userStartSec !== undefined) {
            const fadeOutOffset = Math.max(startSec, Math.max(fadeOut.userStartSec, endSec - playDuration * 0.5));
            fadeGain.gain.setValueAtTime(clipGainValue, fadeOutOffset);
            fadeGain.gain.linearRampToValueAtTime(0, endSec);
        } else {
            fadeGain.gain.setValueAtTime(clipGainValue, Math.max(startSec, endSec - microFadeSeconds));
            fadeGain.gain.linearRampToValueAtTime(0, endSec);
        }
    }

    // duration arg is destination-timeline seconds — NOT buffer-time scaled by playbackRate.
    source.start(startSec, bufferOffsetSec, playDuration);
    return source;
}
