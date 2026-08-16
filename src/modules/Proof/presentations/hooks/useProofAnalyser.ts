/**
 * Hook that provides a high-resolution analyser node for the Proof mastering suite.
 *
 * Creates a separate AnalyserNode with fftSize=4096 (2048 frequency bins)
 * connected to the master output, and provides an animation-frame loop
 * that reads FFT data.
 */
import { useRef, useEffect, useState } from 'react';

import { getMasterAnalyser, getAudioSampleRate, isEngineAudioAvailable } from '#/modules/AudioEngine/useCases';

/**
 * Whether the panel has a working spectrum tap.
 *
 * `unavailable` is a real, displayable state: without it a dead tap looks
 * exactly like a working analyser on a silent master, and the user is left
 * reading an empty spectrum as a mix result.
 *
 * It is decided once, at mount, from the engine's own availability. Connecting
 * the tap cannot decide it — `AudioNode.connect` throws only for a cross-context
 * destination or an out-of-range port, neither of which this call can produce,
 * so it succeeds on the fallback shim exactly as it does on a live graph. A
 * status raised from the frame loop instead cannot decide it either: it reports
 * `unavailable` for the first frame of every mount, which the panel renders as
 * a flash of the dead-tap notice on a working analyser.
 */
export type ProofAnalyserStatus = 'active' | 'unavailable';

export function useProofAnalyser(): {
    status: ProofAnalyserStatus;
    fftData: Float32Array<ArrayBuffer> | null;
    /**
     * Monotonic counter bumped each time `fftData` is refreshed (§174.1).
     *
     * The underlying `Float32Array` is mutated in place so its reference
     * is stable across ticks; consumers that pass `fftData` through a
     * `useEffect` deps array MUST also include `fftVersion` or the effect
     * will only fire once at mount and the live analyser output becomes
     * a static snapshot.
     */
    fftVersion: number;
    sampleRate: number;
    fftSize: number;
} {
    const analyserRef = useRef<AnalyserNode | null>(null);
    const dataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
    // fftData is stored in state so the return value is not a ref access during render.
    // The Float32Array is mutated in place on every rAF tick; state is updated in the
    // rAF callback (not synchronously in the effect body) to carry the stable reference.
    const [fftData, setFftData] = useState<Float32Array<ArrayBuffer> | null>(null);
    const [tick, setTick] = useState(0);
    // Fixed at mount: fallback mode is entered in the engine constructor and never
    // left, so nothing later in this hook's life can change the verdict.
    const [status] = useState<ProofAnalyserStatus>(() =>
        isEngineAudioAvailable() && getMasterAnalyser()?.context ? 'active' : 'unavailable'
    );

    useEffect(() => {
        if (status === 'unavailable') {
            return undefined;
        }
        const masterAnalyser = getMasterAnalyser();
        if (!masterAnalyser?.context) {
            return undefined;
        }

        // Create high-resolution analyser
        const ctx = masterAnalyser.context;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.85;

        // Connect: masterAnalyser output → our analyser (tapping the signal)
        masterAnalyser.connect(analyser);

        analyserRef.current = analyser;
        const buf = new Float32Array(analyser.frequencyBinCount);
        dataRef.current = buf;

        // Animation loop at ~15fps for tonal balance display
        let rafId = 0;
        let frameCount = 0;
        let initialized = false;
        const update = () => {
            rafId = requestAnimationFrame(update);
            frameCount++;
            if (frameCount % 4 !== 0) {
                return;
            } // throttle to ~15fps
            if (analyserRef.current && dataRef.current) {
                analyserRef.current.getFloatFrequencyData(dataRef.current);
                // On the first tick, publish the array reference into state so
                // consumers can read it. Subsequent ticks only bump the version counter.
                if (!initialized) {
                    initialized = true;
                    setFftData(dataRef.current);
                }
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
    }, [status]);

    return {
        status,
        fftData,
        fftVersion: tick,
        sampleRate: getAudioSampleRate(),
        fftSize: 4096,
    };
}
