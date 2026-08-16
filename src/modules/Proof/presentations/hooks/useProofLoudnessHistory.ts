/**
 * Momentary-loudness history for one Proof device, sampled on a fixed clock.
 *
 * The cadence lives here rather than in the graph so the time axis is a real
 * duration: the meter poll pushes ~62 frames a second, and sampling per frame
 * (or per render) filled the whole retained window in under five seconds and
 * let a resize or a target change inject a sample at no elapsed time.
 */
import { useEffect, useRef, useState } from 'react';

import {
    pushProofLoudnessSample,
    readProofLoudnessHistory,
    PROOF_LOUDNESS_SAMPLE_INTERVAL_MS,
} from '../../stores/proofLoudnessHistory';

const NO_SAMPLES: readonly number[] = [];

export function useProofLoudnessHistory(deviceId: string, momentaryLufs: number): readonly number[] {
    // The latest reading, held out of the render path: the clock decides when a
    // value is recorded, not the frame that delivered it.
    const momentaryRef = useRef(momentaryLufs);
    const [samples, setSamples] = useState<readonly number[]>(NO_SAMPLES);

    useEffect(() => {
        momentaryRef.current = momentaryLufs;
    }, [momentaryLufs]);

    useEffect(() => {
        const sample = (): void => {
            pushProofLoudnessSample(deviceId, momentaryRef.current);
            setSamples(readProofLoudnessHistory(deviceId));
        };

        const timer = setInterval(sample, PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
        return () => {
            clearInterval(timer);
        };
    }, [deviceId]);

    return samples;
}
