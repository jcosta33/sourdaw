/**
 * Internal mutable state for the Web MIDI repository.
 * Singleton module — shared across all split files via imports.
 */
import { isTauri } from '#/utils/tauriBridge';

import { type WebMidiState, type MidiLearnState, type ActiveNoteData } from '../../models/WebMidiTypes';

type Subscriber = () => void;

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

let _midiAccess: MIDIAccess | null = null;
let _activeInput: MIDIInput | null = null;
let _targetTrackId: string | null = null;
let _mpeEnabled = false;
let _tauriMode = false;
let _tauriEventUnlisten: (() => void) | null = null;

export function getMidiAccess(): MIDIAccess | null {
    return _midiAccess;
}
export function getActiveInput(): MIDIInput | null {
    return _activeInput;
}
export function getTargetTrackId(): string | null {
    return _targetTrackId;
}
export function getMpeEnabled(): boolean {
    return _mpeEnabled;
}
export function getTauriMode(): boolean {
    return _tauriMode;
}
export function getTauriEventUnlisten(): (() => void) | null {
    return _tauriEventUnlisten;
}

export const activeNotes = new Map<number, ActiveNoteData>();
export const channelToNote = new Map<number, number>();

export const midiLearn: MidiLearnState = {
    active: false,
    callback: null,
};

const STORAGE_KEY = 'sourdaw:midi:selectedInputId';

function readPersistedInputId(): string | null {
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function persistInputId(id: string | null): void {
    try {
        if (id) {
            window.localStorage.setItem(STORAGE_KEY, id);
        } else {
            window.localStorage.removeItem(STORAGE_KEY);
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
    _midiAccess = access;
}
export function setActiveInput(input: MIDIInput | null): void {
    _activeInput = input;
}
export function setTargetTrackId(id: string | null): void {
    _targetTrackId = id;
}
export function setMpeEnabledInternal(enabled: boolean): void {
    _mpeEnabled = enabled;
}
export function getMpeEnabledInternal(): boolean {
    return _mpeEnabled;
}
export function setTauriMode(enabled: boolean): void {
    _tauriMode = enabled;
}
export function setTauriEventUnlisten(fn: (() => void) | null): void {
    _tauriEventUnlisten = fn;
}
