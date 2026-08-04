import { defaultGainEnvelopeStoreState, gainEnvelopeStore } from '../stores/gainEnvelopeStore';
import { markerStore } from '../stores/markerStore';
import { takeLaneStore } from '../stores/takeLaneStore';
import { trackStore } from '../stores/trackStore';
import { vcaGroupStore } from '../stores/vcaGroupStore';

export function resetArrangementStoresForProject(): void {
    trackStore.set({ tracks: [], selectedTrackId: null });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
    vcaGroupStore.set({ groups: [] });
    // Envelopes are keyed by clip id, and clip ids are not unique across
    // projects, so a surviving entry can attach itself to an unrelated clip in
    // the next project rather than merely lingering.
    gainEnvelopeStore.set(defaultGainEnvelopeStoreState);
}
