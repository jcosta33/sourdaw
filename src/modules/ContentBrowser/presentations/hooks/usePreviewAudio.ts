import { useState, useRef, useEffect } from 'react';

import { getAudioContext } from '#/modules/AudioEngine/useCases';

export type PreviewHandle = {
    playingId: string | null;
    play: (id: string, buffer: AudioBuffer) => void;
    playTone: (id: string, frequency: number, durationSec: number) => void;
    playFile: (id: string, file: File) => Promise<void>;
    stop: () => void;
};

function teardownSource(source: AudioScheduledSourceNode | null): void {
    if (source) {
        try {
            source.stop();
        } catch {
            /* already stopped */
        }
        source.disconnect();
    }
}

function createBufferSourceNode(
    ctx: AudioContext,
    buffer: AudioBuffer
): { source: AudioBufferSourceNode; gain: GainNode } {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    source.connect(gain);
    gain.connect(ctx.destination);
    return { source, gain };
}

function createToneOscillator(
    ctx: AudioContext,
    frequency: number,
    durationSec: number
): { osc: OscillatorNode; gain: GainNode } {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    return { osc, gain };
}

export const usePreviewAudio = (): PreviewHandle => {
    // §186.1 — broaden the ref type so it can hold either an audio
    // buffer source or an oscillator. Previously the oscillator path
    // stashed a dummy BufferSource here, so calling stop() silently
    // did nothing and the tone played to completion.
    const sourceRef = useRef<AudioScheduledSourceNode | null>(null);
    const activeRequestIdRef = useRef<number>(0);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const stop = () => {
        activeRequestIdRef.current++;
        teardownSource(sourceRef.current);
        sourceRef.current = null;
        setPlayingId(null);
    };

    const startBufferPlayback = (id: string, buffer: AudioBuffer) => {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            void ctx.resume();
        }

        const { source, gain } = createBufferSourceNode(ctx, buffer);

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

    const play = (id: string, buffer: AudioBuffer) => {
        stop();
        startBufferPlayback(id, buffer);
    };

    const playTone = (id: string, frequency: number, durationSec: number) => {
        stop();

        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            void ctx.resume();
        }

        const { osc, gain } = createToneOscillator(ctx, frequency, durationSec);

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
        stop();
        const requestId = ++activeRequestIdRef.current;
        try {
            const ctx = getAudioContext();
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }
            if (activeRequestIdRef.current !== requestId) {
                return;
            }
            const arrayBuffer = await file.arrayBuffer();
            if (activeRequestIdRef.current !== requestId) {
                return;
            }
            const buffer = await ctx.decodeAudioData(arrayBuffer);
            if (activeRequestIdRef.current !== requestId) {
                return;
            }
            startBufferPlayback(id, buffer);
        } catch {
            // Format not supported or decode failed — preview is best-effort
        }
    };

    // Release any sounding preview node when the consuming component unmounts.
    // Without this, unmounting mid-playback leaves the source running and its
    // gain node connected to ctx.destination (audio keeps sounding, graph
    // leaks). We tear down from the ref directly so the effect can keep an
    // empty dependency array and not capture a stale `stop` closure.
    useEffect(() => {
        return () => {
            activeRequestIdRef.current++;
            teardownSource(sourceRef.current);
            sourceRef.current = null;
        };
    }, []);

    return { playingId, play, playTone, playFile, stop };
};
