import { audioBufferCache } from '../stores/audioBufferCache';

type GetCachedAudioBufferInput = {
    bufferId: string;
};

export function getCachedAudioBuffer({ bufferId }: GetCachedAudioBufferInput): AudioBuffer | null {
    return audioBufferCache.get(bufferId) ?? null;
}
