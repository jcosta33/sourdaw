/**
 * Hook that provides a high-resolution analyser node for the Proof mastering suite.
 *
 * Creates a separate AnalyserNode with fftSize=4096 (2048 frequency bins)
 * connected to the master output, and provides an animation-frame loop
 * that reads FFT data.
 */
import { useRef, useEffect, useState } from 'react';

import { getMasterAnalyser, getAudioSampleRate } from '#/modules/AudioEngine/useCases';

/**
 * Whether the panel has a working spectrum tap.
 *
 * `unavailable` is a real, displayable state: without it a dead tap looks
 * exactly like a working analyser on a silent master, and the user is left
 * reading an empty spectrum as a mix result. It is also the starting state —
 * the tap is `active` from its first delivered frame onwards, never before.
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
    const [status, setStatus] = useState<ProofAnalyserStatus>('unavailable');
    // Bumped to re-run the connect attempt. The tap fails while the context is
    // suspended, which is a transient condition — the panel used to stay blank
    // until it was unmounted and rebuilt.
    const [connectAttempt, setConnectAttempt] = useState(0);

    useEffect(() => {
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
        try {
            masterAnalyser.connect(analyser);
        } catch {
            // Connecting throws while the context is not running. The event that
            // makes it possible is the context changing state, so wait for that
            // and try again instead of leaving the display permanently dead.
            const retry = (): void => setConnectAttempt((attempt) => attempt + 1);
            ctx.addEventListener('statechange', retry);
            return () => {
                ctx.removeEventListener('statechange', retry);
            };
        }

        analyserRef.current = analyser;
        const buf = new Float32Array(analyser.frequencyBinCount);
        dataRef.current = buf;

        // Animation loop at ~15fps for tonal balance display
        let rafId = 0;
        let frameCount = 0;
        let initialized = false;
        let announced = false;
        const update = () => {
            rafId = requestAnimationFrame(update);
            // Announced from the loop rather than the effect body: `unavailable`
            // is the starting state, so only a tap that actually runs has news,
            // and its first frame is the evidence. A status set synchronously in
            // an effect cascades a second render pass on every mount.
            if (!announced) {
                announced = true;
                setStatus('active');
            }
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
    }, [connectAttempt]);

    return {
        status,
        fftData,
        fftVersion: tick,
        sampleRate: getAudioSampleRate(),
        fftSize: 4096,
    };
}
