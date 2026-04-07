import { useState, useRef } from 'react';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';

export type PreviewHandle = {
    playingId: string | null;
    play: (id: string, buffer: AudioBuffer) => void;
    playTone: (id: string, frequency: number, durationSec: number) => void;
    playFile: (id: string, file: File) => Promise<void>;
    stop: () => void;
};

export const usePreviewAudio = (): PreviewHandle => {
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
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

        const dummySource = ctx.createBufferSource();
        sourceRef.current = dummySource;
        setPlayingId(id);

        osc.start();
        osc.stop(ctx.currentTime + durationSec);

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            if (sourceRef.current === dummySource) {
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
