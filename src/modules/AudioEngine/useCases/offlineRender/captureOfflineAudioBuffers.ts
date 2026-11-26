import { type Track } from '#/modules/Arrangement/stores';

import { nativeTimelineMaterialLeases } from '../../repositories/nativeGraph/nativeTimelineMaterialLeases';

import { type OfflineAudioBufferSource } from './OfflineRenderSource';
import { readPlayedFrozenBufferId } from './readPlayedFrozenBufferId';

/** Own the PCM so cache eviction and in-place edits cannot alter a pending render. */
export function captureOfflineAudioBuffers(tracks: readonly Track[], sources: OfflineAudioBufferSource) {
    const buffers = new Map<string, AudioBuffer>();
    const ids = new Set<string>();
    for (const track of tracks) {
        const playedFrozenBufferId = readPlayedFrozenBufferId(track);
        if (playedFrozenBufferId) {
            ids.add(playedFrozenBufferId);
        }
        for (const clip of track.clips) {
            if (clip.audioBufferId) {
                ids.add(clip.audioBufferId);
            }
        }
    }
    for (const id of ids) {
        const source = sources.get(id);
        if (!source) {
            continue;
        }
        const buffer = new AudioBuffer({
            length: source.length,
            numberOfChannels: source.numberOfChannels,
            sampleRate: source.sampleRate,
        });
        for (let channel = 0; channel < source.numberOfChannels; channel++) {
            buffer.copyToChannel(source.getChannelData(channel), channel);
        }
        nativeTimelineMaterialLeases.ownSnapshot(id, buffer, source);
        buffers.set(id, buffer);
    }
    return buffers;
}
