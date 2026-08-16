/**
 * Publishes one Proof device's retained momentary-loudness window for render.
 *
 * Read-only: the samples are taken by the device's own clock, started when the
 * device registers its audio bridge and stopped when it unregisters. This hook
 * only decides how often the graph redraws, so unmounting it — a desk-level
 * switch, a closed panel — costs a redraw and never a sample, and the window a
 * returning graph shows carries the real elapsed time it was away for.
 */
import { useEffect, useState } from 'react';

import { readProofLoudnessHistory, PROOF_LOUDNESS_SAMPLE_INTERVAL_MS } from '../../stores/proofLoudnessHistory';

export function useProofLoudnessHistory(deviceId: string): readonly number[] {
    // Seeded from the retained window rather than empty: the graph unmounts on
    // every desk-level switch, and starting blank until the first redraw is what
    // the module-level buffer exists to prevent.
    const [samples, setSamples] = useState<readonly number[]>(() => readProofLoudnessHistory(deviceId));
    const [publishedDeviceId, setPublishedDeviceId] = useState(deviceId);

    if (publishedDeviceId !== deviceId) {
        // The panel swaps device in place, so the effect below has not restarted
        // the redraw clock yet. Adjusting during render rather than in an effect
        // is what keeps the previous device's history off the incoming device's
        // graph: an effect publishes one paint too late, and the redraw that
        // would fix it is a full interval away.
        setPublishedDeviceId(deviceId);
        setSamples(readProofLoudnessHistory(deviceId));
    }

    useEffect(() => {
        const publish = (): void => {
            setSamples(readProofLoudnessHistory(deviceId));
        };

        const timer = setInterval(publish, PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
        return () => {
            clearInterval(timer);
        };
    }, [deviceId]);

    return samples;
}
