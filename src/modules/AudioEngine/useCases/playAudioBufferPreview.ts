import { logger } from '#/infra/logger/appLogger';
import { runAllEffects } from '#/utils/runEffects';

import { type AudioPreviewIntent } from '../models/AudioPreviewIntent';

import { audioEngine, getAudioContext } from './engineAccess/getAudioContext';
import { createBufferSource } from './scheduling/createBufferSource';

type BufferPreviewInput = {
    buffer: AudioBuffer;
    onEnded: () => void;
    intent?: AudioPreviewIntent;
    gain?: number;
    destination?: AudioNode;
};

function allocatePreviewNodes(context: AudioContext, input: BufferPreviewInput, intent: AudioPreviewIntent) {
    let source: AudioBufferSourceNode;
    try {
        source = createBufferSource();
    } catch (error) {
        intent.release();
        throw error;
    }
    let gain: GainNode | null = null;
    try {
        gain = input.gain === undefined ? null : context.createGain();
    } catch (error) {
        runAllEffects([() => source.disconnect(), () => intent.release()]);
        throw error;
    }
    if (gain !== null && input.gain !== undefined) gain.gain.value = input.gain;
    return { source, gain };
}

/** Play an exact held buffer under its admitting gesture, without entering the project cache. */
export function playAudioBufferPreview(input: BufferPreviewInput): { stop: () => void; ready: Promise<void> } | null {
    if (input.gain !== undefined && (!Number.isFinite(input.gain) || input.gain < 0 || input.gain > 1)) {
        throw new RangeError('An audition gain must be finite and between zero and one.');
    }
    const intent = input.intent ?? audioEngine.beginAudioPreviewIntent();
    if (!intent.isCurrent()) {
        return null;
    }
    const context = getAudioContext();
    const { source, gain } = allocatePreviewNodes(context, input, intent);
    let ended = false;
    let started = false;
    const abort = () => finish(true);
    const detach = () => {
        source.onended = null;
        intent.signal.removeEventListener('abort', abort);
    };
    const finish = (stopSource: boolean, notify = true) => {
        if (ended) {
            return;
        }
        ended = true;
        detach();
        runAllEffects([
            () => gain?.gain.setValueAtTime(0, context.currentTime),
            () => {
                if (stopSource && started) {
                    source.stop();
                }
            },
            () => source.disconnect(),
            () => gain?.disconnect(),
            () => intent.release(),
            () => {
                if (notify) {
                    input.onEnded();
                }
            },
        ]);
    };
    const start = () => {
        if (ended || !intent.isCurrent()) {
            finish(false);
            throw new Error('The audio preview gesture was superseded before playback.');
        }
        try {
            started = true;
            source.start();
        } catch (error) {
            finish(false, false);
            throw error;
        }
    };
    try {
        source.buffer = input.buffer;
        const destination = input.destination ?? context.destination;
        if (gain === null) {
            source.connect(destination);
        } else {
            source.connect(gain);
            gain.connect(destination);
        }
        source.onended = () => finish(false);
        intent.signal.addEventListener('abort', abort);
        if (!intent.isCurrent()) {
            finish(false);
            return null;
        }
        if (intent.ready === undefined) {
            start();
        }
    } catch (error) {
        finish(false, false);
        throw error;
    }
    const ready = intent.ready === undefined ? Promise.resolve() : intent.ready.then(start);
    void ready.catch((error: unknown) => {
        const wasCancelled = intent.signal.aborted;
        if (!ended) {
            finish(false);
        }
        if (!wasCancelled) {
            logger.warn(new Error('Audio preview could not restore its listening output', { cause: error }));
        }
    });
    return { stop: () => finish(true), ready };
}
