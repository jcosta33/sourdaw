/**
 * Hook that provides a high-resolution analyser node for the Proof mastering suite.
 *
 * Creates a separate AnalyserNode with fftSize=4096 (2048 frequency bins)
 * connected to this Proof instance's own output node, and provides an
 * animation-frame loop that reads FFT data. Tonal balance measures the chain
 * the instance sits in — the device's own signal — never the master bus.
 */
import { useRef, useEffect, useState } from 'react';

import { getDeviceOutputNode, getAudioSampleRate, isEngineAudioAvailable } from '#/modules/AudioEngine/useCases';

/**
 * How often a panel mounted before its device's worklet finished loading
 * re-checks for the device's graph node. Pure UI cadence, off the audio thread.
 */
const DEVICE_TAP_POLL_INTERVAL_MS = 250;

/**
 * Whether the panel has a working spectrum tap.
 *
 * `unavailable` is a real, displayable state: without it a dead tap looks
 * exactly like a working analyser on a silent signal, and the user is left
 * reading an empty spectrum as a mix result.
 *
 * It is decided from the engine's own availability and from the device's
 * loaded graph node, never from connecting or from the frame loop:
 * connecting the tap cannot decide it — `AudioNode.connect` throws only for a
 * cross-context destination or an out-of-range port, neither of which this
 * call can produce, so it succeeds on the fallback shim exactly as it does on
 * a live graph. A status raised from the frame loop instead cannot decide it
 * either: it reports `unavailable` for the first frame of every mount, which
 * the panel renders as a flash of the dead-tap notice on a working analyser.
 *
 * The status never demotes. A device whose WASM worklet has not finished
 * loading has no graph node to tap yet, so its panel starts `unavailable` and
 * polls for the node, raising the status once when it appears — the notice is
 * truthful the whole time and the rise is not a flash.
 */
export type ProofAnalyserStatus = 'active' | 'unavailable';

function hasTapableDeviceNode(deviceId: string): boolean {
    return isEngineAudioAvailable() && getDeviceOutputNode(deviceId)?.context !== undefined;
}

export function useProofAnalyser(deviceId: string): {
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
    // left, so nothing later in this hook's life can change the verdict — except
    // a device node arriving from its asynchronous load, which only ever raises
    // the status (see `ProofAnalyserStatus`).
    const [status, setStatus] = useState<ProofAnalyserStatus>(() =>
        hasTapableDeviceNode(deviceId) ? 'active' : 'unavailable'
    );

    // A device that is still loading its worklet has no graph node at mount.
    // Poll until it appears, then raise the status once; the connect effect
    // below owns the tap from there. The engine's own availability is not
    // re-checked: fallback mode is permanent, so an engine-level `unavailable`
    // has nothing to wait for.
    useEffect(() => {
        if (status !== 'unavailable' || !isEngineAudioAvailable()) {
            return undefined;
        }
        const poll = setInterval(() => {
            if (hasTapableDeviceNode(deviceId)) {
                clearInterval(poll);
                setStatus('active');
            }
        }, DEVICE_TAP_POLL_INTERVAL_MS);
        return () => {
            clearInterval(poll);
        };
    }, [status, deviceId]);

    useEffect(() => {
        if (status === 'unavailable') {
            return undefined;
        }
        const deviceNode = getDeviceOutputNode(deviceId);
        if (!deviceNode?.context) {
            return undefined;
        }

        // Create high-resolution analyser
        const ctx = deviceNode.context;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.85;

        // Connect: this instance's own output → our analyser (tapping the signal)
        deviceNode.connect(analyser);

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
                deviceNode.disconnect(analyser);
            } catch {
                /* */
            }
            analyserRef.current = null;
        };
    }, [status, deviceId]);

    return {
        status,
        fftData,
        fftVersion: tick,
        sampleRate: getAudioSampleRate(),
        fftSize: 4096,
    };
}
