import {
    adjustmentLayerStore,
    gainEnvelopeStore,
    takeLaneStore,
    trackStore,
    vcaGroupStore,
} from '#/modules/Arrangement/stores';
import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { sidechainStore } from '#/modules/Routing/stores';

/**
 * Calls `listener` on every write to a store a `SubgraphPrintInputSource` field is read from, so a
 * caller comparing print inputs over time sees each change. Returns the unsubscribe.
 */
export function subscribeSubgraphPrintInputStores(listener: () => void): () => void {
    const unsubscribes = [
        trackStore.subscribe(listener),
        midiStore.subscribe(listener),
        automationStore.subscribe(listener),
        sidechainStore.subscribe(listener),
        vcaGroupStore.subscribe(listener),
        takeLaneStore.subscribe(listener),
        gainEnvelopeStore.subscribe(listener),
        adjustmentLayerStore.subscribe(listener),
        modulationStore.subscribe(listener),
    ];
    return () => {
        for (const unsubscribe of unsubscribes) {
            unsubscribe();
        }
    };
}
