import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

/**
 * After the whole source is mirrored, `[offset, offset + length)` lives at
 * `[D - offset - length, D - offset)`. Point `audioOffsetBeats` there so a
 * trimmed, split, or slipped clip still plays its own window backwards.
 */
function reversedClipAudioOffsetBeats(input: {
    audioOffsetBeats: number;
    clipLengthBeats: number;
    bufferLength: number;
    sampleRate: number;
    tempo: number;
}): number | undefined {
    const { audioOffsetBeats, clipLengthBeats, bufferLength, sampleRate, tempo } = input;
    if (!Number.isFinite(audioOffsetBeats) || !Number.isFinite(clipLengthBeats)) {
        return undefined;
    }
    if (!Number.isFinite(bufferLength) || bufferLength <= 0) {
        return undefined;
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        return undefined;
    }
    const clipSecondsPerBeat = Number.isFinite(tempo) && tempo > 0 ? 60 / tempo : 0;
    if (clipSecondsPerBeat <= 0) {
        return undefined;
    }
    const sourceLengthBeats = bufferLength / sampleRate / clipSecondsPerBeat;
    if (!Number.isFinite(sourceLengthBeats)) {
        return undefined;
    }
    return sourceLengthBeats - audioOffsetBeats - clipLengthBeats;
}

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
    const clipTempo = transportStore.value?.tempo ?? 120;
    const didWrite = updateClip(target.clipId, (candidate) => {
        cacheAudioBuffer({ buffer: reversed, bufferId: newId });
        const remappedAudioOffsetBeats = reversedClipAudioOffsetBeats({
            audioOffsetBeats: candidate.audioOffsetBeats ?? 0,
            clipLengthBeats: candidate.endBeat - candidate.startBeat,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            tempo: clipTempo,
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
        if (remappedAudioOffsetBeats === undefined) {
            return reversedClip;
        }
        return { ...reversedClip, audioOffsetBeats: remappedAudioOffsetBeats };
    });
    if (!didWrite) {
        return false;
    }

    clearClipPitchAnalysis(target.clipId);
    return true;
}
