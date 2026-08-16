import { tauriInvoke } from '#/utils/tauriBridge';

import { type WebMidiInputMessage } from '../../../models/WebMidiTypes';
import { getTauriEventUnlisten } from '../getTauriEventUnlisten';
import { mapNativeMidiTimestamp } from '../mapNativeMidiTimestamp';
import { resetNativeMidiTimeAnchor } from '../resetNativeMidiTimeAnchor';
import { setTauriEventUnlisten } from '../setTauriEventUnlisten';

type TauriMidiMessageEvent = {
    payload: {
        data: number[];
        /**
         * midir's callback stamp in microseconds, on a platform-defined origin.
         * Typed `unknown` because it arrives over IPC and the guard below
         * validates only `data`: a malformed stamp must cost the note its
         * arrival time, never the note itself.
         */
        timestamp?: unknown;
    };
};

function isNumberArray(value: unknown): value is number[] {
    if (!Array.isArray(value)) {
        return false;
    }
    if (value.length < 2 || value.length > 3) {
        return false;
    }

    return value.every(
        (entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 255
    );
}

function isTauriMidiMessageEvent(event: unknown): event is TauriMidiMessageEvent {
    if (typeof event !== 'object' || event === null) {
        return false;
    }

    if (!('payload' in event)) {
        return false;
    }

    const { payload } = event;
    if (typeof payload !== 'object' || payload === null) {
        return false;
    }

    if (!('data' in payload)) {
        return false;
    }

    return isNumberArray(payload.data);
}

function readNativeTimestampMicros(event: TauriMidiMessageEvent): number | undefined {
    const { timestamp } = event.payload;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
        return undefined;
    }

    return timestamp;
}

type SelectMidiInputTauriInput = {
    portIndex: number;
    /**
     * The name the caller resolved `portIndex` from. The index is only valid
     * for the enumeration it came from, and `open_midi_input` re-enumerates:
     * a port appearing below the target in that window shifts every index and
     * silently opens a different instrument. The backend reports the name it
     * actually opened, so when the caller says what it expected, a mismatch is
     * detected and backed out instead of persisted.
     */
    portName?: string;
    onMidiMessage: (event: WebMidiInputMessage) => void;
};

/**
 * Monotonic token for in-flight selections. The unlisten registry is read at
 * call start but written three awaits later, so two overlapping selections
 * would race: the earlier one could finish last and overwrite the newer
 * registration, orphaning its listener on the shared `midi-message` channel.
 */
let selectionGeneration = 0;

export async function selectMidiInputTauri({
    portIndex,
    portName,
    onMidiMessage,
}: SelectMidiInputTauriInput): Promise<void> {
    selectionGeneration += 1;
    const generation = selectionGeneration;

    const currentUnlisten = getTauriEventUnlisten();
    if (currentUnlisten) {
        currentUnlisten();
        setTauriEventUnlisten(null);
    }

    const openedName = await tauriInvoke('open_midi_input', { portIndex });

    if (generation !== selectionGeneration) {
        // A newer selection started while the port was opening; it owns the
        // registry from here — including the port itself, which its own
        // `open_midi_input` has already replaced.
        return;
    }

    if (portName !== undefined && typeof openedName === 'string' && openedName !== portName) {
        await tauriInvoke('close_midi_input');
        throw new Error(`MIDI port ${portIndex} is now "${openedName}", expected "${portName}"`);
    }

    resetNativeMidiTimeAnchor();

    const { tauriListen } = await import('#/utils/tauriBridge');
    const newUnlisten = await tauriListen('midi-message', (event) => {
        // Read first: this is the closest we get to the instant the message
        // reached us, and every line below adds to the gap.
        const receivedAtMs = performance.now();

        if (!isTauriMidiMessageEvent(event)) {
            return;
        }

        const bytes = event.payload.data;
        const uint8 = new Uint8Array(bytes);
        const timeStamp = mapNativeMidiTimestamp({
            timestampMicros: readNativeTimestampMicros(event),
            receivedAtMs,
        });

        // Populating `timeStamp` is the entire native half of the arrival-time
        // path — every handler downstream already reads it and resolves the
        // event against it. Leave it out and they read the clock at
        // handler-run time instead, which measures main-thread jitter rather
        // than when the note was played.
        onMidiMessage({ data: uint8, timeStamp });
    });

    if (generation !== selectionGeneration) {
        // Superseded while subscribing. Drop this listener instead of
        // overwriting the newer one, or both stay subscribed and every note
        // is delivered twice.
        newUnlisten();
        return;
    }

    setTauriEventUnlisten(newUnlisten);
}
