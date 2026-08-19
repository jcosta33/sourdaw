/**
 * Web MIDI store — public read contract for the Web MIDI subsystem.
 *
 * Created with the default state; the real initial value (support detection
 * plus the persisted input id) and ongoing sync from the repository's internal
 * mutable state are wired in `repositories/webMidi/store.ts`, which runs when
 * the Web MIDI init path loads. The store stays pure here because `stores/`
 * may not import `repositories/` or the desktop bridge (dependency-boundary
 * rules `usecases-only-write-boundary-to-repositories` and
 * `desktop-ipc-only-in-repositories`).
 */
import { createStore } from '#/infra/store/createStore';

import { type WebMidiState } from '../models/WebMidiTypes';

export const defaultWebMidiState: WebMidiState = {
    isSupported: false,
    inputs: [],
    selectedInputId: null,
};

export const webMidiStore = createStore<WebMidiState>({
    initialData: defaultWebMidiState,
});
