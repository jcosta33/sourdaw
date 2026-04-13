import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { getTempoAtBeat } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { getGainAtBeat, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { scheduleFrozenTrack } from './scheduleMidiNotes';
import { type SourceWithFade } from '../playheadScheduler';

const MICRO_FADE_SECONDS = 0.003;

/**
 * §109.1 — Holder-wrapped dedup Set. Hashes for which we have already
 * sent a peer request this session. Prevents spamming requestAsset()
 * every scheduler tick while waiting.
 */
const assetRequestState: { requestedAssets: Set<string> } = {
    requestedAssets: new Set<string>(),
};

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

    for (const track of tracks) {
        if (track.kind !== 'audio' || track.muted) {
            continue;
        }

        if (track.frozen && track.frozenBufferId) {
            if (!scheduledFrozenTracks.has(track.id)) {
                const scheduled = scheduleFrozenTrack(
                    track,
                    accumulatedPosition,
                    activeAudioSources,
                    currentTempo
                );
                if (scheduled) {
                    scheduledFrozenTracks.add(track.id);
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

            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                const isRecordingClip = clip.audioBufferId.startsWith('rec-');
                if (!isRecordingClip) {
                    const inSession = collaborationStore.value?.isEnabled ?? false;
                    if (inSession && clip.assetHash) {
                        if (!assetRequestState.requestedAssets.has(clip.assetHash)) {
                            assetRequestState.requestedAssets.add(clip.assetHash);
                            getAssetTransfer()?.requestAsset(clip.assetHash);
                        }
                    } else {
                        notifyUser(
                            `Missing audio for clip "${clip.name}" — re-import the audio file`,
                            'warning'
                        );
                        scheduledAudioClipsSet.add(clipKey);
                    }
                }
                continue;
            }

            scheduledAudioClipsSet.add(clipKey);

            const strip = ensureTrackStrip(track.id);
            const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;
            const clipTempo = getTempoAtBeat(changes, clip.startBeat, transport.tempo);
            const clipBeatsPerSecond = clipTempo / 60;
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffsetBeats = iter * loopLen;
                const iterStartBeat = clip.startBeat + iterOffsetBeats;
                if (iterStartBeat >= clip.endBeat) {
                    break;
                }

                const remainingBeats = clip.endBeat - iterStartBeat;
                const iterDurationBeats = Math.min(loopLen, remainingBeats);
                const iterDurationSeconds = iterDurationBeats / clipBeatsPerSecond;

                const source = createBufferSource();
                source.buffer = buffer;
                if (stretchRatio !== 1) {
                    source.playbackRate.value = stretchRatio;
                }

                const isFirstIter = iter === 0;
                const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;
                const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
                const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;
                const fadeGain = getAudioContext().createGain();
                (source as SourceWithFade).fadeGainNode = fadeGain;

                const envGainDb = getGainAtBeat(clip.id, iterOffsetBeats);
                const hasEnvGain = envGainDb !== 0;
                const envGainNode = hasEnvGain ? getAudioContext().createGain() : null;
                if (envGainNode) {
                    envGainNode.gain.value = Math.pow(10, envGainDb / 20);
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

                const beatOffset = iterStartBeat - accumulatedPosition;
                const iterStartTime =
                    getCurrentTime() + beatOffset / (currentTempo / 60) + compensation;
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
                        continue;
                    }
                }

                if (fadeGain) {
                    const effectiveStart = Math.max(iterStartTime, now);

                    if (isFirstIter && clip.fadeInBeats > 0) {
                        const fadeInEnd = iterStartTime + clip.fadeInBeats / clipBeatsPerSecond;
                        if (effectiveStart < fadeInEnd) {
                            const progressRatio =
                                Math.max(0, effectiveStart - iterStartTime) /
                                (clip.fadeInBeats / clipBeatsPerSecond);
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
                        const clipEndTime =
                            getCurrentTime() +
                            (clip.endBeat - accumulatedPosition) / (currentTempo / 60) +
                            compensation;
                        const fadeOutStart = clipEndTime - clip.fadeOutBeats / clipBeatsPerSecond;
                        fadeGain.gain.setValueAtTime(1, Math.max(fadeOutStart, effectiveStart));
                        fadeGain.gain.linearRampToValueAtTime(0, clipEndTime);
                    } else if (needsMicroFadeOut) {
                        const iterEndTime = effectiveStart + playDuration;
                        fadeGain.gain.setValueAtTime(
                            1,
                            Math.max(effectiveStart, iterEndTime - MICRO_FADE_SECONDS)
                        );
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
                        fadeGain.disconnect();
                    }
                    if (envGainNode) {
                        envGainNode.disconnect();
                    }
                };
            }
        }
    }
}
