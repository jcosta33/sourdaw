import { crumbsStore } from './crumbsStore';

/** Observe accepted sample identities, excluding waveform and other store updates. */
export function subscribeToCrumbsSamples(onSample: (deviceId: string) => void): () => void {
    let previous = crumbsStore.value;
    return crumbsStore.subscribe((current) => {
        const before = previous;
        previous = current;
        for (const [deviceId, state] of Object.entries(current ?? {})) {
            if (state.activeSample && state.activeSample !== before?.[deviceId]?.activeSample) {
                onSample(deviceId);
            }
        }
    });
}
