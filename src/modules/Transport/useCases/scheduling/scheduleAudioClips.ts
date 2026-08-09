import { trackStore } from '#/modules/Arrangement/stores';
import { getGainAtBeat, projectClipLoopExpansion, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
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
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTempoAtBeat } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { type SourceWithFade } from '../playheadScheduler/schedulerSession';

import { gainNodePool, sessionState } from './audioClipSchedulingState';
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

// Vite HMR: clear the pool + asset dedup before this module is replaced so a
// fresh AudioContext never inherits GainNodes wired into the disposed graph.
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
    transport: TransportState,
    currentTempo: number
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
                const scheduled = scheduleFrozenTrack(track, accumulatedPosition, activeAudioSources, currentTempo);
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
                        if (!sessionState.requestedAssets.has(clip.assetHash)) {
                            sessionState.requestedAssets.add(clip.assetHash);
                            getAssetTransfer()?.requestAsset(clip.assetHash);
                        }
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
            // Both the iteration start time and its duration must derive from the
            // *same* tempo basis or, under a tempo curve, the audible clip length
            // drifts from its visual length (the start time used the scheduler's
            // currentTempo while the duration used the clip's local tempo). Buffer-
            // content offsets stay on `clipBeatsPerSecond` (the rate the audio was
            // rendered at); only timeline placement/duration use this mapping.
            const timelineBeatsPerSecond = currentTempo / 60;
            function beatToAudioTime(beat: number): number {
                return getCurrentTime() + (beat - accumulatedPosition) / timelineBeatsPerSecond + compensation;
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
                const iterDurationSeconds = iterDurationBeats / timelineBeatsPerSecond;

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
                const playDuration = Math.min(
                    iterDurationSeconds,
                    (buffer.duration - clipAudioOffsetSeconds) / stretchRatio
                );

                if (iterStartTime >= now) {
                    source.start(iterStartTime, clipAudioOffsetSeconds, playDuration * stretchRatio);
                } else {
                    const elapsed = now - iterStartTime;
                    const bufferOffset = elapsed * stretchRatio + clipAudioOffsetSeconds;
                    if (
                        bufferOffset < buffer.duration &&
                        bufferOffset < playDuration * stretchRatio + clipAudioOffsetSeconds
                    ) {
                        source.start(
                            now,
                            bufferOffset,
                            playDuration * stretchRatio + clipAudioOffsetSeconds - bufferOffset
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
                    const effectiveStart = Math.max(iterStartTime, now);

                    if (isFirstIter && clip.fadeInBeats > 0) {
                        const fadeInEnd = iterStartTime + clip.fadeInBeats / clipBeatsPerSecond;
                        if (effectiveStart < fadeInEnd) {
                            const progressRatio =
                                Math.max(0, effectiveStart - iterStartTime) / (clip.fadeInBeats / clipBeatsPerSecond);
                            fadeGain.gain.setValueAtTime(progressRatio, effectiveStart);
                            fadeGain.gain.linearRampToValueAtTime(1, fadeInEnd);
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
                        const fadeOutStart = clipEndTime - clip.fadeOutBeats / clipBeatsPerSecond;
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
