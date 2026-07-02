/**
 * Internal mutable state for the Web MIDI repository.
 * Singleton module — shared across all split files via imports.
 */
import { isTauri } from '#/utils/tauriBridge';

import { type WebMidiState, type MidiLearnState, type ActiveNoteData } from '../../models/WebMidiTypes';

import { readPersistedInputId } from './readPersistedInputId';

export type WebMidiSubscriber = () => void;

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export const activeNotes = new Map<number, ActiveNoteData>();
export const channelToNote = new Map<number, number>();

export const midiLearn: MidiLearnState = {
    active: false,
    callback: null,
};

export const webMidiRuntime = {
    midiAccess: null as MIDIAccess | null,
    activeInput: null as MIDIInput | null,
    midiMessageListener: null as EventListener | null,
    targetTrackId: null as string | null,
    mpeEnabled: false,
    tauriMode: false,
    tauriEventUnlisten: null as (() => void) | null,
};

export const webMidiState: { current: WebMidiState } = {
    current: {
        isSupported: webMidiSupported || isTauri(),
        inputs: [],
        selectedInputId: readPersistedInputId(),
    },
};

export const webMidiSubscribers = new Set<WebMidiSubscriber>();
