import { createStore } from '#/infra/store/createStore';

import { type EngineEvent, type EngineRtDiagnostics } from '../models/EngineRtDiagnostics';

export type { EngineEvent, EngineRtDiagnostics, EngineStreamErrorKind } from '../models/EngineRtDiagnostics';

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
    events: [],
};

export const engineRtDiagnosticsStore = createStore<EngineRtDiagnosticsState>({
    initialData: defaultEngineRtDiagnosticsState,
});
