import { runAllEffects } from '#/utils/runEffects';

import { audioBufferCache } from '../stores/audioBufferCache';

import { audioEngine, getAudioContext } from './engineAccess/getAudioContext';
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
    const intent = audioEngine.beginAudioPreviewIntent();
    if (!intent.isCurrent()) {
        return null;
    }

    let source: AudioBufferSourceNode;
    try {
        source = createBufferSource();
    } catch (error) {
        intent.release();
        throw error;
    }
    let ended = false;
    const abort = () => finish(true);
    const detach = () => {
        source.onended = null;
        intent.signal.removeEventListener('abort', abort);
    };
    const finish = (stopSource: boolean) => {
        if (ended) {
            return;
        }
        ended = true;
        detach();
        runAllEffects([
            () => {
                if (stopSource) {
                    source.stop();
                }
            },
            () => source.disconnect(),
            () => intent.release(),
            onEnded,
        ]);
    };

    try {
        source.buffer = buffer;
        source.connect(getAudioContext().destination);
        source.onended = () => finish(false);
        intent.signal.addEventListener('abort', abort);
        if (!intent.isCurrent()) {
            finish(false);
            return null;
        }
        source.start();
    } catch (error) {
        if (ended) {
            throw error;
        }
        ended = true;
        detach();
        runAllEffects([
            () => source.disconnect(),
            () => intent.release(),
            () => {
                throw error;
            },
        ]);
    }
    return { stop: () => finish(true) };
}
