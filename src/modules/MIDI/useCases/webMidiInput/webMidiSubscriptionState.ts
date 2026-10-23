type WebMidiSubscriptionState = {
    disposeTrackStoreSubscription: (() => void) | null;
    disposeYeastNotesOffSubscription: (() => void) | null;
    disposeRecordedControllerTakeSubscription: (() => void) | null;
};

export const webMidiSubscriptionState: WebMidiSubscriptionState = {
    disposeTrackStoreSubscription: null,
    disposeYeastNotesOffSubscription: null,
    disposeRecordedControllerTakeSubscription: null,
};
