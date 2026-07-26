import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

import { sanitize_transport_snapshot, transportStore } from '../stores/transportStore';

export function restoreTransportSnapshot(snapshot: unknown): void {
    const restored = sanitize_transport_snapshot(snapshot);
    transportStore.set(restored);
    setMasterGainValue(restored.masterGain / 100);
}
