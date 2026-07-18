/**
 * Web MIDI store - wraps the internal state for React integration.
 */
import { createStore } from '#/infra/store/createStore';

import { type WebMidiState } from '../../models/WebMidiTypes';

import { getState } from './getState';
import { subscribe } from './subscribe';

const defaultWebMidiState: WebMidiState = {
    isSupported: false,
    inputs: [],
    selectedInputId: null,
};

export const webMidiStore = createStore<WebMidiState>({
    initialData: getState() ?? defaultWebMidiState,
});

// Sync internal state changes to the store
subscribe(() => {
    const current = getState();
    if (current) {
        webMidiStore.set(current);
    }
});
