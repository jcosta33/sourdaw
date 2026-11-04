import { audioBufferCache } from '../stores/audioBufferCache';

import { playAudioBufferPreview } from './playAudioBufferPreview';

/** The cached-buffer adapter keeps cache misses and the ordinary synchronous path unchanged. */
export function playCachedAudioBufferPreview(input: {
    bufferId: string;
    onEnded: () => void;
}): { stop: () => void } | null {
    const buffer = audioBufferCache.get(input.bufferId);
    if (buffer === undefined || buffer === null) {
        return null;
    }
    const playback = playAudioBufferPreview({ buffer, onEnded: input.onEnded });
    return playback === null ? null : { stop: playback.stop };
}
