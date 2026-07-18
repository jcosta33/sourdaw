/**
 * Web MIDI store sync adapter.
 *
 * Keeps the public read-contract store (`stores/webMidiStore.ts`) in sync with
 * this repository's internal mutable state. Importing this module registers the
 * subscription as a side effect; it is loaded from the Web MIDI init path
 * (`lifecycle/initWebMidi.ts`) so the subscription exists before the first
 * `setState` input enumeration. Repository → same-module store is the sanctioned
 * thin-adapter pattern (`repositories-no-business` exempts `stores/`).
 */
import { webMidiStore } from '../../stores/webMidiStore';

import { getState } from './getState';
import { subscribe } from './subscribe';

// Seed the store with the repository's current internal state (support
// detection + persisted input id computed in state.ts), then keep it in sync
// with every subsequent internal state change.
webMidiStore.set(getState());

subscribe(() => {
    webMidiStore.set(getState());
});
