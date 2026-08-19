/**
 * Internal mutable state for the Web MIDI repository.
 * Singleton module — shared across all split files via imports.
 */
import { isDesktopRuntime } from '#/utils/desktopBridge';

import {
    type WebMidiState,
    type MidiLearnState,
    type ActiveNoteData,
    type WebMidiNoteKey,
} from '../../models/WebMidiTypes';

import { readPersistedInputId } from './readPersistedInputId';

export type WebMidiSubscriber = () => void;

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export const activeNotes = new Map<WebMidiNoteKey, ActiveNoteData>();
export const channelToNote = new Map<number, WebMidiNoteKey>();

export const midiLearn: MidiLearnState = {
    active: false,
    callback: null,
};

export const webMidiRuntime = {
    midiAccess: null as MIDIAccess | null,
    activeInput: null as MIDIInput | null,
    midiMessageListener: null as EventListener | null,
    targetTrackId: null as string | null,
    targetTrackOwnerId: null as string | null,
    targetTrackRevision: 0,
    mpeEnabled: false,
    nativeMode: false,
    nativeEventUnlisten: null as (() => void) | null,
    /**
     * Milliseconds to add to a native MIDI stamp to express it on the
     * `performance.now()` clock. Null until the first message on a port teaches
     * it; see `mapNativeMidiTimestamp`.
     */
    nativeMidiTimeAnchorMs: null as number | null,
};

export const webMidiState: { current: WebMidiState } = {
    current: {
        isSupported: webMidiSupported || isDesktopRuntime(),
        inputs: [],
        selectedInputId: readPersistedInputId(),
    },
};

export const webMidiSubscribers = new Set<WebMidiSubscriber>();
