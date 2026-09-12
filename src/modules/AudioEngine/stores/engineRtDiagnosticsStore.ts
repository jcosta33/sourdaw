import { createStore } from '#/infra/store/createStore';

import { type EngineEvent, type EngineRtDiagnostics } from '../models/EngineRtDiagnostics';

/**
 * How many engine events the store keeps. A stream failing every period repeats
 * itself, and the oldest reports are the ones that already explained the fault,
 * so the window is bounded rather than growing for the life of the session.
 */
export const ENGINE_EVENT_HISTORY_LIMIT = 128;

export type EngineRtDiagnosticsState = {
    /** Null until the first refresh — no reading is not the same as all zeros. */
    latest: EngineRtDiagnostics | null;
    /**
     * Whether a reading taken from a native engine that exists has been
     * published at any point this session.
     *
     * Sticky: it never returns to false once set. The events below outlive the
     * engine that reported them, while an engine that stops rendering is
     * retired and its handle dropped, so every reading after that carries the
     * no-engine shape. A reader that asked `latest` whether an engine exists
     * would discard a recorded fault at the moment that fault retired the
     * engine which reported it.
     */
    nativeEngineObserved: boolean;
    /**
     * Every event observed so far, oldest first.
     *
     * Accumulated rather than replaced: the native command drains its ring, so
     * each event is delivered exactly once and a refresh that overwrote this
     * list would discard everything reported before it.
     */
    events: EngineEvent[];
};

export const defaultEngineRtDiagnosticsState: EngineRtDiagnosticsState = {
    latest: null,
    nativeEngineObserved: false,
    events: [],
};

export const engineRtDiagnosticsStore = createStore<EngineRtDiagnosticsState>({
    initialData: defaultEngineRtDiagnosticsState,
});
