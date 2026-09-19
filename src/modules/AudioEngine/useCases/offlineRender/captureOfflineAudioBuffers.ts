import { type Track } from '#/modules/Arrangement/stores';

/** Own the PCM so cache eviction and in-place edits cannot alter a pending render. */
export function captureOfflineAudioBuffers(tracks: readonly Track[], sources: ReadonlyMap<string, AudioBuffer>) {
    const buffers = new Map<string, AudioBuffer>();
    const ids = new Set<string>();
    for (const track of tracks) {
        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            ids.add(track.freezeState.frozenBufferId);
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
        buffers.set(id, buffer);
    }
    return buffers;
}
