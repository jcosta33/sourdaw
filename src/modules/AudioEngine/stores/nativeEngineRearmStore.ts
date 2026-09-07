import { createStore } from '#/infra/store/createStore';

/**
 * How many lost native engines this renderer has retired and is offering a
 * re-arm for (#3960).
 *
 * Bumped once per engine `retireOrphanedNativeEngine` actually retired.
 * `Transport`'s `rearmNativeSessionAfterEngineRetire` subscribes and restarts
 * the session when the musician is still playing.
 *
 * A count rather than a boolean, because the subscriber has to see every offer:
 * two retires in a row are two writes, while a flag set twice is one write a
 * subscriber may only be notified about once.
 */
export type NativeEngineRearmState = {
    offers: number;
};

export const defaultNativeEngineRearmState: NativeEngineRearmState = {
    offers: 0,
};

export const nativeEngineRearmStore = createStore<NativeEngineRearmState>({
    initialData: defaultNativeEngineRearmState,
});
