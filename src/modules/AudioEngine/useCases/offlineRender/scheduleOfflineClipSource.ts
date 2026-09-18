/**
 * Start one piece of source material, with the level envelope that keeps its
 * edges from clicking.
 *
 * Lifted out of `scheduleTrackClips`, which is still its only caller on the
 * export path, so that the offline `AudioGraphBackend` implements the
 * contract's clip command with the same body rather than a second one written
 * to match it. The two branch conditions the caller used to evaluate — "is
 * this the first iteration, untrimmed" and "is this the last" — became the
 * presence of {@link OfflineClipFadeIn} and {@link OfflineClipFadeOut}.
 * Fade lengths go through the shared half-play-duration clamp (#2867) that
 * the live scheduler also uses.
 */

import { clampClipFadeInDurationSeconds, clampClipFadeOutStartSeconds } from '#/utils/clipFadeScheduleClamp';
import {
    applyGainCurveAnchorsToParam,
    foldGainCurveAnchorsToAudibleStart,
    type GainCurveAnchor,
} from '#/utils/clipGainEnvelopeSchedule';

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

/**
 * One anchor of a clip's gain-envelope curve, already on the destination
 * timeline: when the curve reaches this level, as a linear amplitude (#2865).
 */
export type OfflineClipEnvelopeAnchor = Readonly<{
    timeSec: number;
    gain: number;
}>;

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
     * The clip's gain-envelope curve over this playback, in destination
     * seconds (#2865). Absent when the clip carries no envelope the render
     * applies. A curve cannot share the fade param with the fades below — a
     * param timeline is one series, and two curves on one node multiply only
     * through two nodes — so this rides its own gain node, exactly as the
     * live scheduler chains one beside its fade gain.
     */
    envelope?: readonly OfflineClipEnvelopeAnchor[];
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
        envelope,
        microFadeSeconds,
    } = input;

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (playbackRate !== 1) {
        source.playbackRate.value = playbackRate;
    }

    const endSec = startSec + playDuration;

    // Source → envelope → fade → destination, the same chain the live
    // scheduler builds (and in the same node order — fade first, envelope
    // second): the envelope shapes the material, the fades own the edges, and
    // the clip's own level stays the plateau the fades target.
    const fadeGain = context.createGain();
    const envelopeGain = context.createGain();
    source.connect(envelopeGain);
    envelopeGain.connect(fadeGain);
    fadeGain.connect(destinationNode);

    if (envelope && envelope.length > 0) {
        // Folded to where this playback's sound begins — the same hold the
        // live scheduler makes at its own audible start — so an iteration
        // entered part-way by a region trim or a pre-roll enters the curve at
        // the level it holds there instead of stepping to a breakpoint.
        const anchors = foldGainCurveAnchorsToAudibleStart(
            envelope.map((anchor): GainCurveAnchor => ({ time: anchor.timeSec, gain: anchor.gain })),
            startSec
        );
        applyGainCurveAnchorsToParam(envelopeGain.gain, anchors);
    }

    fadeGain.gain.setValueAtTime(clipGainValue, startSec);

    if (fadeIn) {
        if (fadeIn.userEndSec !== undefined) {
            const fadeInDuration = clampClipFadeInDurationSeconds(
                fadeIn.userEndSec - startSec,
                playDuration,
                microFadeSeconds
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
            const fadeOutOffset = clampClipFadeOutStartSeconds(
                Math.min(fadeOut.userStartSec, Math.max(startSec, endSec - microFadeSeconds)),
                startSec,
                playDuration
            );
            fadeGain.gain.setValueAtTime(clipGainValue, fadeOutOffset);
            fadeGain.gain.linearRampToValueAtTime(0, endSec);
        } else {
            fadeGain.gain.setValueAtTime(clipGainValue, Math.max(startSec, endSec - microFadeSeconds));
            fadeGain.gain.linearRampToValueAtTime(0, endSec);
        }
    }

    // `start`'s third argument is measured in the *source buffer's* own time:
    // the node stops once it has consumed that many source seconds, which takes
    // `duration / playbackRate` seconds on the destination timeline. Everything
    // above — `endSec`, both fade spans — is destination seconds, so the one
    // number that leaves that frame is scaled into source seconds here, exactly
    // as the live scheduler does. The caller clamps `playDuration` to
    // `(buffer.duration - bufferOffsetSec) / playbackRate`, so the scaled value
    // never reaches past the end of the material.
    source.start(startSec, bufferOffsetSec, playDuration * playbackRate);
    return source;
}
