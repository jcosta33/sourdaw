import { createStore } from '#/infra/store/createStore';

/**
 * Session / Clip Launcher active-slot state.
 *
 * §83.2 — the SessionView component previously kept its active-slot map
 * in local React state, so closing and reopening the panel silently
 * discarded which clips were launched. A module-level store at least
 * preserves the state across panel toggles within a session. Wiring
 * slot launches through to the audio engine (so launching a slot
 * actually triggers clip playback) is tracked as follow-up feature work
 * — this store only fixes the UI data-loss bug.
 */
export type SessionLaunchState = {
    /** trackId → scene index currently active for that track. */
    activeSlots: Record<string, number>;
};

const defaultState: SessionLaunchState = { activeSlots: {} };

export const sessionLaunchStore = createStore<SessionLaunchState>({ initialData: defaultState });
