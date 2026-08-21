import { trackStore } from '#/modules/Arrangement/stores';
import { getGainAtBeat, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTempoAtBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { type SourceWithFade } from '../playheadScheduler/schedulerSession';

import { gainNodePool } from './audioClipSchedulingState';
import { disposeAudioClipScheduling } from './disposeAudioClipScheduling';
import { scheduleFrozenTrack } from './scheduleFrozenTrack';

const MICRO_FADE_SECONDS = 0.003;

function acquireGainNode(ctx: BaseAudioContext): GainNode {
    const node = gainNodePool.pop();
    if (node) {
        node.gain.cancelScheduledValues(ctx.currentTime);
        node.gain.setValueAtTime(1, ctx.currentTime);
        return node;
    }
    return ctx.createGain();
}

function releaseGainNode(node: GainNode, ctx: BaseAudioContext): void {
    try {
        node.disconnect();
        node.gain.cancelScheduledValues(ctx.currentTime);
        gainNodePool.push(node);
    } catch {
        // node might already be disconnected
    }
}

// Vite HMR: clear the pool before this module is replaced so a fresh
// AudioContext never inherits GainNodes wired into the disposed graph.
import.meta.hot?.dispose(() => {
    disposeAudioClipScheduling();
});

export function scheduleAudioClips(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    scheduledAudioClipsSet: Set<string>,
    scheduledFrozenTracks: Set<string>,
    activeAudioSources: AudioBufferSourceNode[],
    transport: TransportState
): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const changes = tempoMapStore.value?.changes ?? [];
    const ctx = getAudioContext();

    for (const track of tracks) {
        if (track.kind !== 'audio' || track.muted) {
            continue;
        }

        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            // Key by content, not just track.id (same contract as
            // scheduleMidiNotes): an unfreeze → refreeze keeps the track id but
            // replaces frozenBufferId, and a bare-id key would keep the dedup
            // entry and leave the refrozen track silent for the whole session.
            const frozenKey = `${track.id}:${track.freezeState.frozenBufferId}`;
            if (!scheduledFrozenTracks.has(frozenKey)) {
                const scheduled = scheduleFrozenTrack(track, accumulatedPosition, activeAudioSources, transport.tempo);
                if (scheduled) {
                    scheduledFrozenTracks.add(frozenKey);
                }
            }
            continue;
        }

        const compensation = getCompensationDelay(track.id);
        const resolvedAudioClips = resolveClipsWithComping(track.id, track.clips);

        for (const clip of resolvedAudioClips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type !== 'audio' || !clip.audioBufferId) {
                continue;
            }
            const clipKey = `${clip.id}:${clip.regionStartBeat}:${clip.regionEndBeat}`;
            if (scheduledAudioClipsSet.has(clipKey)) {
                continue;
            }
            if (clip.startBeat > toBeat || clip.endBeat < fromBeat) {
                continue;
            }

            const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
            if (!buffer) {
                const isRecordingClip = clip.audioBufferId.startsWith('rec-');
                if (!isRecordingClip) {
                    const inSession = collaborationStore.value?.isEnabled ?? false;
                    if (inSession && clip.assetHash) {
                        // Deliberately unconditional: AssetTransfer owns both the
                        // dedup and the retry policy, because only it knows
                        // whether a request is still alive. It drops calls while
                        // one is outstanding or in flight, holds a cooldown after
                        // an abort, and abandons a hash that keeps failing. A
                        // dedup Set here instead recorded "asked once, ever":
                        // after a corrupt chunk or a dead sender aborted the
                        // transfer, the asset could never be re-requested for the
                        // rest of the session and the clip stayed silent forever.
                        getAssetTransfer()?.requestAsset(clip.assetHash);
                    } else {
                        notifyUser(`Missing audio for clip "${clip.name}" — re-import the audio file`, 'warning');
                        scheduledAudioClipsSet.add(clipKey);
                    }
                }
                continue;
            }

            const strip = ensureTrackStrip(track.id);
            const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;
            const clipTempo = getTempoAtBeat(changes, clip.startBeat, transport.tempo);
            const clipBeatsPerSecond = clipTempo / 60;

            // Single source of truth for beat → audio-context time on the timeline.
            // Every timeline quantity — iteration start, iteration length, fade
            // boundaries — goes through this one mapping, so they cannot disagree
            // about the tempo basis. It integrates the tempo map instead of
            // dividing by the tempo at the playhead: with a tempo change inside
            // the look-ahead the flat rate placed the clip at the wrong instant
            // and sized it wrongly, drifting against MIDI, which converts through
            // the map. Buffer-*content* offsets stay on `clipBeatsPerSecond`, the
            // rate the audio itself was rendered at.
            function beatToAudioTime(beat: number): number {
                return (
                    getCurrentTime() +
                    secondsBetweenBeats(changes, accumulatedPosition, beat, transport.tempo) +
                    compensation
                );
            }

            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopProjection = projectClipLoopExpansion({
                clipDurationBeats: clipVisualLength,
                configuredLoopLengthBeats: clip.loopLength,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const loopLen = loopProjection.loopLengthBeats;
            const maxIterations = loopProjection.iterationCount;
            const loopEnabled = clip.loopEnabled ?? false;
            let startIteration = 0;
            let endIteration = Math.min(1, maxIterations);
            if (loopEnabled) {
                startIteration = Math.max(0, Math.floor((fromBeat - clip.startBeat) / loopLen));
                endIteration = Math.min(maxIterations, Math.ceil((toBeat - clip.startBeat) / loopLen));
                startIteration = Math.min(startIteration, endIteration);
            }

            for (let iter = startIteration; iter < endIteration; iter++) {
                const iterOffsetBeats = iter * loopLen;
                const iterStartBeat = clip.startBeat + iterOffsetBeats;
                if (iterStartBeat >= clip.endBeat) {
                    break;
                }
                const scheduledIterationKey = loopEnabled ? `${clipKey}:${String(iter)}` : clipKey;
                if (scheduledAudioClipsSet.has(scheduledIterationKey)) {
                    continue;
                }
                scheduledAudioClipsSet.add(scheduledIterationKey);

                const remainingBeats = clip.endBeat - iterStartBeat;
                const iterDurationBeats = Math.min(loopLen, remainingBeats);
                // Timeline duration of this iteration: derived from the same beat→time
                // mapping as iterStartTime so start and length agree under a tempo curve.
                const iterDurationSeconds = secondsBetweenBeats(
                    changes,
                    iterStartBeat,
                    iterStartBeat + iterDurationBeats,
                    transport.tempo
                );

                const source = createBufferSource();
                source.buffer = buffer;
                if (stretchRatio !== 1) {
                    source.playbackRate.value = stretchRatio;
                }

                const isFirstIter = iter === 0;
                const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;
                const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
                const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;

                const fadeGain = acquireGainNode(ctx);
                (source as SourceWithFade).fadeGainNode = fadeGain;

                const envGainDb = getGainAtBeat(clip.id, iterOffsetBeats);
                const hasEnvGain = envGainDb !== 0;
                const envGainNode = hasEnvGain ? acquireGainNode(ctx) : null;
                if (envGainNode) {
                    envGainNode.gain.value = 10 ** (envGainDb / 20);
                }

                let outputNode: AudioNode = strip.gainNode;
                if (fadeGain) {
                    fadeGain.connect(outputNode);
                    outputNode = fadeGain;
                }
                if (envGainNode) {
                    envGainNode.connect(outputNode);
                    outputNode = envGainNode;
                }
                source.connect(outputNode);

                const iterStartTime = beatToAudioTime(iterStartBeat);
                const now = getCurrentTime();
                const clipAudioOffsetBeats = clip.audioOffsetBeats ?? 0;
                const clipAudioOffsetSeconds = clipAudioOffsetBeats / clipBeatsPerSecond;
                // A negative offset — reachable and unfloored from both write
                // paths, `slipClipContent` and a leftward left-edge drag in
                // `trimClipStart` — puts the clip's head before the start of
                // its source. Handing that number to `start()` is the
                // `RangeError` the Web Audio specification requires, and this
                // call sits in the scheduler tick with no `catch` around it, so
                // the throw also skips that tick's automation, VCA and
                // modulation passes.
                //
                // The professional answer (Live, Cubase) is silence across the
                // negative span and then the file from sample 0, which is what
                // the offline render bounces. The span is source seconds, so
                // crossing it costs `span / rate` of the timeline; the
                // iteration still ends where the clip says it does, so the
                // pre-roll shortens what is heard rather than moving the tail.
                const sourceOffsetSeconds = Math.max(0, clipAudioOffsetSeconds);
                const preRollSeconds = Math.max(0, -clipAudioOffsetSeconds) / stretchRatio;
                const soundStartTime = iterStartTime + preRollSeconds;
                const playDuration = Math.min(
                    iterDurationSeconds - preRollSeconds,
                    (buffer.duration - sourceOffsetSeconds) / stretchRatio
                );

                // Nothing audible remains: the pre-roll swallowed the iteration,
                // or the offset already sits past the end of the material.
                // Starting a zero-length source would only burn a node.
                if (playDuration <= 0) {
                    releaseGainNode(fadeGain, ctx);
                    if (envGainNode) {
                        releaseGainNode(envGainNode, ctx);
                    }
                    continue;
                }

                if (soundStartTime >= now) {
                    source.start(soundStartTime, sourceOffsetSeconds, playDuration * stretchRatio);
                } else {
                    const elapsed = now - soundStartTime;
                    const bufferOffset = elapsed * stretchRatio + sourceOffsetSeconds;
                    if (
                        bufferOffset < buffer.duration &&
                        bufferOffset < playDuration * stretchRatio + sourceOffsetSeconds
                    ) {
                        source.start(
                            now,
                            bufferOffset,
                            playDuration * stretchRatio + sourceOffsetSeconds - bufferOffset
                        );
                    } else {
                        // Source isn't started, release resources immediately
                        releaseGainNode(fadeGain, ctx);
                        if (envGainNode) {
                            releaseGainNode(envGainNode, ctx);
                        }
                        continue;
                    }
                }

                if (fadeGain) {
                    // Anchored to where sound begins, not to the clip's head:
                    // with no pre-roll the two are the same instant, and with
                    // one there is nothing to ramp until the source reaches
                    // sample 0. The fade *window* below stays measured from the
                    // clip head, so a pre-roll that outruns it leaves the gain
                    // already at 1 — the ramp happened during the silence.
                    const effectiveStart = Math.max(soundStartTime, now);

                    if (isFirstIter && clip.fadeInBeats > 0) {
                        // A fade length is a span of the timeline, so it is measured
                        // with the timeline's own mapping. Dividing by the clip's
                        // local rate made the ramp outlast (or undershoot) its beat
                        // span whenever a tempo change fell inside the fade.
                        const fadeInSeconds = secondsBetweenBeats(
                            changes,
                            iterStartBeat,
                            iterStartBeat + clip.fadeInBeats,
                            transport.tempo
                        );
                        const fadeInEnd = iterStartTime + fadeInSeconds;
                        if (effectiveStart < fadeInEnd) {
                            const progressRatio = Math.max(0, effectiveStart - iterStartTime) / fadeInSeconds;
                            fadeGain.gain.setValueAtTime(progressRatio, effectiveStart);
                            fadeGain.gain.linearRampToValueAtTime(1, fadeInEnd);
                        } else if (preRollSeconds > 0) {
                            // The drawn fade window fully elapsed inside the pre-roll
                            // silence, so `effectiveStart` lands past `fadeInEnd` with
                            // nothing left to ramp — but drawing a fade is the gesture
                            // that says "no click here", and the source is about to
                            // start on a discontinuity regardless. Give it the same
                            // anti-click MICRO_FADE_SECONDS gives an undrawn fade,
                            // rather than jumping straight to unity. This leaves the
                            // no-pre-roll transport-resume case (preRollSeconds === 0)
                            // alone: that one starts mid-buffer, where the
                            // discontinuity is unavoidable and a ramp would only mask
                            // real material.
                            fadeGain.gain.setValueAtTime(0, effectiveStart);
                            fadeGain.gain.linearRampToValueAtTime(1, effectiveStart + MICRO_FADE_SECONDS);
                        } else {
                            fadeGain.gain.setValueAtTime(1, effectiveStart);
                        }
                    } else if (needsMicroFadeIn) {
                        fadeGain.gain.setValueAtTime(0, effectiveStart);
                        fadeGain.gain.linearRampToValueAtTime(1, effectiveStart + MICRO_FADE_SECONDS);
                    } else {
                        fadeGain.gain.setValueAtTime(1, effectiveStart);
                    }

                    if (isLastIter && clip.fadeOutBeats > 0) {
                        const clipEndTime = beatToAudioTime(clip.endBeat);
                        const fadeOutStart =
                            clipEndTime -
                            secondsBetweenBeats(
                                changes,
                                clip.endBeat - clip.fadeOutBeats,
                                clip.endBeat,
                                transport.tempo
                            );
                        fadeGain.gain.setValueAtTime(1, Math.max(fadeOutStart, effectiveStart));
                        fadeGain.gain.linearRampToValueAtTime(0, clipEndTime);
                    } else if (needsMicroFadeOut) {
                        const iterEndTime = effectiveStart + playDuration;
                        fadeGain.gain.setValueAtTime(1, Math.max(effectiveStart, iterEndTime - MICRO_FADE_SECONDS));
                        fadeGain.gain.linearRampToValueAtTime(0, iterEndTime);
                    }
                }

                activeAudioSources.push(source);
                source.onended = () => {
                    const idx = activeAudioSources.indexOf(source);
                    if (idx >= 0) {
                        activeAudioSources.splice(idx, 1);
                    }
                    if (fadeGain) {
                        releaseGainNode(fadeGain, ctx);
                    }
                    if (envGainNode) {
                        releaseGainNode(envGainNode, ctx);
                    }
                };
            }
        }
    }
}
