/**
 * Hook that provides a high-resolution analyser node for the Proof mastering suite.
 *
 * Creates a separate AnalyserNode with fftSize=4096 (2048 frequency bins)
 * connected to the master output, and provides an animation-frame loop
 * that reads FFT data.
 */
import { useRef, useEffect, useState } from 'react';
import { getMasterAnalyser, getAudioSampleRate } from '#/modules/AudioEngine/useCases';

export function useProofAnalyser(): {
    fftData: Float32Array<ArrayBuffer> | null;
    sampleRate: number;
    fftSize: number;
} {
    const analyserRef = useRef<AnalyserNode | null>(null);
    const dataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const masterAnalyser = getMasterAnalyser();
        if (!masterAnalyser?.context) return;

        // Create high-resolution analyser
        const ctx = masterAnalyser.context;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.85;

        // Connect: masterAnalyser output → our analyser (tapping the signal)
        try {
            masterAnalyser.connect(analyser);
        } catch {
            // May fail if context is not running
            return;
        }

        analyserRef.current = analyser;
        dataRef.current = new Float32Array(analyser.frequencyBinCount);

        // Animation loop at ~15fps for tonal balance display
        let rafId = 0;
        let frameCount = 0;
        const update = () => {
            rafId = requestAnimationFrame(update);
            frameCount++;
            if (frameCount % 4 !== 0) return; // throttle to ~15fps
            if (analyserRef.current && dataRef.current) {
                analyserRef.current.getFloatFrequencyData(dataRef.current);
                setTick((t) => t + 1);
            }
        };
        rafId = requestAnimationFrame(update);

        return () => {
            cancelAnimationFrame(rafId);
            try {
                analyser.disconnect();
            } catch {
                /* */
            }
            try {
                masterAnalyser.disconnect(analyser);
            } catch {
                /* */
            }
            analyserRef.current = null;
        };
    }, []);

    tick; // trigger re-render when FFT data updates
    return {
        fftData: dataRef.current,
        sampleRate: getAudioSampleRate(),
        fftSize: 4096,
    };
}
