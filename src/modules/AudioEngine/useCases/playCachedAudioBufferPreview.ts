import { audioBufferCache } from '../stores/audioBufferCache';

import { getAudioContext } from './engineAccess/getAudioContext';
import { createBufferSource } from './scheduling/createBufferSource';

type PlayCachedAudioBufferPreviewInput = {
    bufferId: string;
    onEnded: () => void;
};

type PreviewAudioBufferPlayback = {
    stop: () => void;
};

type PlayCachedAudioBufferPreviewOutput = PreviewAudioBufferPlayback | null;

export function playCachedAudioBufferPreview({
    bufferId,
    onEnded,
}: PlayCachedAudioBufferPreviewInput): PlayCachedAudioBufferPreviewOutput {
    const buffer = audioBufferCache.get(bufferId);
    if (!buffer) {
        return null;
    }

    const source = createBufferSource();
    source.buffer = buffer;
    source.connect(getAudioContext().destination);
    source.onended = onEnded;
    source.start();
    return {
        stop: () => {
            source.stop();
        },
    };
}
