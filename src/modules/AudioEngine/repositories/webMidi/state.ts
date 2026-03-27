/**
 * Internal mutable state for the Web MIDI repository.
 * Singleton module — shared across all split files via imports.
 */
import { isTauri } from '#/helpers/tauriBridge';
import { type WebMidiState, type MidiLearnState, type ActiveNoteData } from '#/modules/AudioEngine/models/WebMidiTypes';

type Subscriber = () => void;

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export let midiAccess: MIDIAccess | null = null;
export let activeInput: MIDIInput | null = null;
export let targetTrackId: string | null = null;
export let mpeEnabled = false;
export let tauriMode = false;
export let tauriEventUnlisten: (() => void) | null = null;

export const activeNotes = new Map<number, ActiveNoteData>();
export const channelToNote = new Map<number, number>();

export const midiLearn: MidiLearnState = {
    active: false,
    callback: null,
};

let state: WebMidiState = {
    isSupported: webMidiSupported || isTauri(),
    inputs: [],
    selectedInputId: null,
};

const subscribers = new Set<Subscriber>();

function notify(): void {
    for (const fn of subscribers) {
        fn();
    }
}

export function setState(next: Partial<WebMidiState>): void {
    state = { ...state, ...next };
    notify();
}

export function getState(): WebMidiState {
    return state;
}

export function subscribe(callback: Subscriber): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

export function getSnapshot(): WebMidiState {
    return state;
}

// Setters for module-level state
export function setMidiAccess(access: MIDIAccess | null): void {
    midiAccess = access;
}
export function setActiveInput(input: MIDIInput | null): void {
    activeInput = input;
}
export function setTargetTrackId(id: string | null): void {
    targetTrackId = id;
}
export function setMpeEnabledInternal(enabled: boolean): void {
    mpeEnabled = enabled;
}
export function getMpeEnabledInternal(): boolean {
    return mpeEnabled;
}
export function setTauriMode(enabled: boolean): void {
    tauriMode = enabled;
}
export function setTauriEventUnlisten(fn: (() => void) | null): void {
    tauriEventUnlisten = fn;
}
