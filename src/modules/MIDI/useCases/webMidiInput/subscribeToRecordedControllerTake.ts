import { transportStore } from '#/modules/Transport/stores';

import { beginRecordedControllerTake } from '../recordedControllerTake/beginRecordedControllerTake';
import { endRecordedControllerTake } from '../recordedControllerTake/endRecordedControllerTake';

import { webMidiSubscriptionState } from './webMidiSubscriptionState';

/**
 * Follow the transport's recording edges so the live input's controller rows
 * belong to exactly one take: a rising edge starts it (and reads the pedals
 * already down), a falling edge settles what no commit will.
 */
export function subscribeToRecordedControllerTake(): void {
    if (webMidiSubscriptionState.disposeRecordedControllerTakeSubscription) {
        return;
    }

    let wasRecording = transportStore.value?.isRecording === true;
    webMidiSubscriptionState.disposeRecordedControllerTakeSubscription = transportStore.subscribe((transport) => {
        const isRecording = transport?.isRecording === true;
        if (isRecording === wasRecording) {
            return;
        }
        wasRecording = isRecording;
        if (isRecording) {
            beginRecordedControllerTake();
            return;
        }
        // The dispatch settles on its own and logs its failure; the edge does not wait on it.
        void endRecordedControllerTake();
    });
}
