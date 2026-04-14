import { useState, useRef } from 'react';
import { getAudioContext } from '#/modules/AudioEngine/useCases';

export type PreviewHandle = {
    playingId: string | null;
    play: (id: string, buffer: AudioBuffer) => void;
    playTone: (id: string, frequency: number, durationSec: number) => void;
    playFile: (id: string, file: File) => Promise<void>;
    stop: () => void;
};

export const usePreviewAudio = (): PreviewHandle => {
    // §186.1 — broaden the ref type so it can hold either an audio
    // buffer source or an oscillator. Previously the oscillator path
    // stashed a dummy BufferSource here, so calling stop() silently
    // did nothing and the tone played to completion.
    const sourceRef = useRef<AudioScheduledSourceNode | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const stop = () => {
        if (sourceRef.current) {
            try {
                sourceRef.current.stop();
            } catch {
                /* already stopped */
            }
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        setPlayingId(null);
    };

    const play = (id: string, buffer: AudioBuffer) => {
        stop();

        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const gain = ctx.createGain();
        gain.gain.value = 0.7;
        source.connect(gain);
        gain.connect(ctx.destination);

        source.onended = () => {
            source.disconnect();
            gain.disconnect();
            if (sourceRef.current === source) {
                sourceRef.current = null;
                setPlayingId(null);
            }
        };

        sourceRef.current = source;
        setPlayingId(id);
        source.start();
    };

    const playTone = (id: string, frequency: number, durationSec: number) => {
        stop();

        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

        osc.connect(gain);
        gain.connect(ctx.destination);

        sourceRef.current = osc;
        setPlayingId(id);

        osc.start();
        osc.stop(ctx.currentTime + durationSec);

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            if (sourceRef.current === osc) {
                sourceRef.current = null;
                setPlayingId(null);
            }
        };
    };

    const playFile = async (id: string, file: File): Promise<void> => {
        try {
            const ctx = getAudioContext();
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }
            const arrayBuffer = await file.arrayBuffer();
            const buffer = await ctx.decodeAudioData(arrayBuffer);
            play(id, buffer);
        } catch {
            // Format not supported or decode failed — preview is best-effort
        }
    };

    return { playingId, play, playTone, playFile, stop };
};
