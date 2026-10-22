import { webMidiSubscriptionState } from './webMidiSubscriptionState';

export function disposeWebMidiSubscriptions(): void {
    const {
        disposeTrackStoreSubscription,
        disposeYeastNotesOffSubscription,
        disposeRecordedControllerTakeSubscription,
    } = webMidiSubscriptionState;
    webMidiSubscriptionState.disposeTrackStoreSubscription = null;
    webMidiSubscriptionState.disposeYeastNotesOffSubscription = null;
    webMidiSubscriptionState.disposeRecordedControllerTakeSubscription = null;

    try {
        disposeTrackStoreSubscription?.();
    } finally {
        try {
            disposeYeastNotesOffSubscription?.();
        } finally {
            disposeRecordedControllerTakeSubscription?.();
        }
    }
}
