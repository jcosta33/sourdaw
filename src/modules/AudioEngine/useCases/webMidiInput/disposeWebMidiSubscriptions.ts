import { webMidiSubscriptionState } from './webMidiSubscriptionState';

export function disposeWebMidiSubscriptions(): void {
    const { disposeTrackStoreSubscription, disposeYeastNotesOffSubscription } = webMidiSubscriptionState;
    webMidiSubscriptionState.disposeTrackStoreSubscription = null;
    webMidiSubscriptionState.disposeYeastNotesOffSubscription = null;

    try {
        disposeTrackStoreSubscription?.();
    } finally {
        disposeYeastNotesOffSubscription?.();
    }
}
