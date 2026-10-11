import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

import { reversedClipAudioSource } from './reversedClipAudioSource';

/**
 * `reversedBufferId` is resolved by the command layer before dispatch rather than minted
 * here, so the handler's `describe()` can name the buffer this run will produce and guard
 * its inverse on it. A caller outside the command path may omit it.
 */
export function reverseClip(clipId: string, reversedBufferId?: string): boolean {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === target.clipId);
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return false;
    }
    if (clip.loopEnabled) {
        notifyUser(
            'Reverse cannot preserve the playback window of a looped clip. Bounce the whole looped clip to audio first.',
            'error'
        );
        return false;
    }

    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return false;
    }

    const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const reversed = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel);
        const destination = reversed.getChannelData(channel);
        for (let index = 0; index < source.length; index++) {
            destination[index] = source[source.length - 1 - index]!;
        }
    }

    const newId = reversedBufferId ?? `reversed-${clip.audioBufferId}-${Date.now()}`;
    const clipTempo = readTempoAtBeat({ beat: clip.startBeat });
    const elapsedTimelineSeconds =
        readSecondsAtBeat({ beat: clip.endBeat }) - readSecondsAtBeat({ beat: clip.startBeat });
    const didWrite = updateClip(target.clipId, (candidate) => {
        cacheAudioBuffer({ buffer: reversed, bufferId: newId });
        const remappedAudioSource = reversedClipAudioSource({
            audioOffsetSeconds: candidate.audioOffsetSeconds,
            audioOffsetBeats: candidate.audioOffsetBeats,
            elapsedTimelineSeconds,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            tempo: clipTempo,
            stretchMode: candidate.stretchMode,
            stretchRatio: candidate.stretchRatio,
        });
        const reversedClip = {
            ...candidate,
            audioBufferId: newId,
            name: `${candidate.name} (reversed)`,
            // The audio now plays back-to-front, so the fades trade places: the
            // fade-in drawn at the head is a fade-out over the reversed tail.
            fadeInBeats: candidate.fadeOutBeats,
            fadeOutBeats: candidate.fadeInBeats,
        };
        if (!remappedAudioSource) {
            return reversedClip;
        }
        return { ...reversedClip, ...remappedAudioSource };
    });
    if (!didWrite) {
        return false;
    }

    clearClipPitchAnalysis(target.clipId);
    return true;
}
