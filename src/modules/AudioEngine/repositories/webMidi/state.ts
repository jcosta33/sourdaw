/**
 * Internal mutable state for the Web MIDI repository.
 * Singleton module — shared across all split files via imports.
 */
import { isTauri } from '#/utils/tauriBridge';
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

const STORAGE_KEY = 'sourdaw:midi:selectedInputId';

function readPersistedInputId(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function persistInputId(id: string | null): void {
    try {
        if (id) {
            localStorage.setItem(STORAGE_KEY, id);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // storage not available
    }
}

let state: WebMidiState = {
    isSupported: webMidiSupported || isTauri(),
    inputs: [],
    selectedInputId: readPersistedInputId(),
};

const subscribers = new Set<Subscriber>();

function notify(): void {
    for (const fn of subscribers) {
        fn();
    }
}

export function setState(next: Partial<WebMidiState>): void {
    state = { ...state, ...next };
    if ('selectedInputId' in next) {
        persistInputId(next.selectedInputId ?? null);
    }
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
