import { useState, useRef, useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { audioEngine, getAudioContext, playAudioBufferPreview } from '#/modules/AudioEngine/useCases';

export type PreviewHandle = {
    playingId: string | null;
    play: (id: string, buffer: AudioBuffer) => void;
    playTone: (id: string, frequency: number, durationSec: number) => void;
    playFile: (id: string, file: File) => Promise<void>;
    stop: () => void;
};

type Owner = {
    intent: ReturnType<typeof audioEngine.beginAudioPreviewIntent>;
    stop: () => void;
};

export const usePreviewAudio = (): PreviewHandle => {
    const ownerRef = useRef<Owner | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const release = () => {
        const owner = ownerRef.current;
        ownerRef.current = null;
        try {
            owner?.stop();
        } finally {
            owner?.intent.release();
        }
    };
    const stop = () => {
        release();
        setPlayingId(null);
    };
    const begin = (): Owner | null => {
        stop();
        const intent = audioEngine.beginAudioPreviewIntent();
        if (!intent.isCurrent()) {
            return null;
        }
        const owner: Owner = { intent, stop: () => undefined };
        ownerRef.current = owner;
        intent.signal.addEventListener(
            'abort',
            () => {
                owner.stop();
                if (ownerRef.current === owner) {
                    ownerRef.current = null;
                    setPlayingId(null);
                }
            },
            { once: true }
        );
        return owner;
    };
    const isCurrent = (owner: Owner) => ownerRef.current === owner && owner.intent.isCurrent();
    const report = (owner: Owner, error: unknown) => {
        if (isCurrent(owner)) {
            stop();
            logger.warn(new Error('Browser audio preview failed', { cause: error }));
        }
    };
    const resume = (owner: Owner): Promise<void> => {
        const context = getAudioContext();
        const resuming = context.state === 'suspended' ? context.resume() : Promise.resolve();
        void resuming.catch((error: unknown) => report(owner, error));
        return resuming;
    };
    const startBuffer = (owner: Owner, id: string, buffer: AudioBuffer) => {
        if (!isCurrent(owner)) {
            return;
        }
        const playback = playAudioBufferPreview({
            buffer,
            gain: 0.7,
            intent: owner.intent,
            onEnded: () => {
                if (ownerRef.current === owner) {
                    ownerRef.current = null;
                    setPlayingId(null);
                }
            },
        });
        if (playback === null) {
            return;
        }
        owner.stop = playback.stop;
        if (isCurrent(owner)) {
            setPlayingId(id);
        }
        void playback.ready.catch((error: unknown) => report(owner, error));
    };
    const play = (id: string, buffer: AudioBuffer) => {
        const owner = begin();
        if (owner === null) {
            return;
        }
        void resume(owner);
        startBuffer(owner, id, buffer);
    };
    const playTone = (id: string, frequency: number, durationSec: number) => {
        const owner = begin();
        if (owner === null) {
            return;
        }
        void resume(owner);
        const playback = audioEngine.playAudioPreviewTone(frequency, durationSec, owner.intent);
        if (playback === null) {
            return;
        }
        owner.stop = playback.stop;
        if (isCurrent(owner)) {
            setPlayingId(id);
        }
        void playback.ready.catch((error: unknown) => report(owner, error));
    };
    const playFile = async (id: string, file: File): Promise<void> => {
        // The gesture owns cancellation before resume, file reads or decoding;
        // decoded completion never acquires a new intent over a newer A/B.
        const owner = begin();
        if (owner === null) {
            return;
        }
        try {
            await resume(owner);
            if (!isCurrent(owner)) {
                return;
            }
            const bytes = await file.arrayBuffer();
            if (!isCurrent(owner)) {
                return;
            }
            const buffer = await getAudioContext().decodeAudioData(bytes);
            if (isCurrent(owner)) {
                startBuffer(owner, id, buffer);
            }
        } catch {
            // Unsupported files remain a best-effort browser preview.
            if (isCurrent(owner)) {
                stop();
            }
        }
    };
    useEffect(
        () => () => {
            const owner = ownerRef.current;
            ownerRef.current = null;
            try {
                owner?.stop();
            } finally {
                owner?.intent.release();
            }
        },
        []
    );
    return { playingId, play, playTone, playFile, stop };
};
