import {
    subscribe as subscribeToWebMidiState,
    getSnapshot as getWebMidiSnapshot,
} from '../repositories/webMidi/state';
import {
    initWebMidi as initializeWebMidi,
    selectMidiInput as chooseMidiInput,
    setMidiInputTrack as setWebMidiInputTrack,
    setMpeEnabled as setWebMidiMpeEnabled,
    resetMidiState as resetWebMidiState,
} from '../repositories/webMidi/lifecycle';
import { webMidiStore as webMidiStateStore } from '../repositories/webMidi/store';

export type MidiInputInfo = {
    id: string;
    name: string;
    manufacturer: string;
};

/**
 * Public contract for Web MIDI state and lifecycle operations.
 */
export function subscribe(
    ...args: Parameters<typeof subscribeToWebMidiState>
): ReturnType<typeof subscribeToWebMidiState> {
    return subscribeToWebMidiState(...args);
}

export function getSnapshot(
    ...args: Parameters<typeof getWebMidiSnapshot>
): ReturnType<typeof getWebMidiSnapshot> {
    return getWebMidiSnapshot(...args);
}

export function initWebMidi(
    ...args: Parameters<typeof initializeWebMidi>
): ReturnType<typeof initializeWebMidi> {
    return initializeWebMidi(...args);
}

export function selectMidiInput(
    ...args: Parameters<typeof chooseMidiInput>
): ReturnType<typeof chooseMidiInput> {
    return chooseMidiInput(...args);
}

export function setMidiInputTrack(
    ...args: Parameters<typeof setWebMidiInputTrack>
): ReturnType<typeof setWebMidiInputTrack> {
    return setWebMidiInputTrack(...args);
}

export function setMpeEnabled(
    ...args: Parameters<typeof setWebMidiMpeEnabled>
): ReturnType<typeof setWebMidiMpeEnabled> {
    return setWebMidiMpeEnabled(...args);
}

export function resetMidiState(
    ...args: Parameters<typeof resetWebMidiState>
): ReturnType<typeof resetWebMidiState> {
    return resetWebMidiState(...args);
}

export const webMidiStore = webMidiStateStore;
