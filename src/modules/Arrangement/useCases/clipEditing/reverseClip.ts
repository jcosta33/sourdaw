import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

export function reverseClip(clipId: string): boolean {
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

    const newId = `reversed-${clip.audioBufferId}-${Date.now()}`;
    const didWrite = updateClip(target.clipId, (candidate) => {
        cacheAudioBuffer({ buffer: reversed, bufferId: newId });
        return {
            ...candidate,
            audioBufferId: newId,
            name: `${candidate.name} (reversed)`,
        };
    });
    if (!didWrite) {
        return false;
    }

    clearClipPitchAnalysis(target.clipId);
    return true;
}
