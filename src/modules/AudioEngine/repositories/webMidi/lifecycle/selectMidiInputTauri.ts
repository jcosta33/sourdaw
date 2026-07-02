import { tauriInvoke } from '#/utils/tauriBridge';

import { getTauriEventUnlisten } from '../getTauriEventUnlisten';
import { onMidiMessage } from '../messageHandlers';
import { setTauriEventUnlisten } from '../setTauriEventUnlisten';

type TauriMidiMessageEvent = {
    payload: {
        data: number[];
    };
};

function isNumberArray(value: unknown): value is number[] {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.every((entry): entry is number => typeof entry === 'number');
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

export async function selectMidiInputTauri(portIndex: number): Promise<void> {
    const currentUnlisten = getTauriEventUnlisten();
    if (currentUnlisten) {
        currentUnlisten();
        setTauriEventUnlisten(null);
    }

    await tauriInvoke('open_midi_input', { portIndex });

    const { tauriListen } = await import('#/utils/tauriBridge');
    const newUnlisten = await tauriListen('midi-message', (event) => {
        if (!isTauriMidiMessageEvent(event)) {
            return;
        }

        const bytes = event.payload.data;
        if (bytes.length < 2) {
            return;
        }

        const uint8 = new Uint8Array(bytes);
        onMidiMessage({ data: uint8 } as MIDIMessageEvent);
    });
    setTauriEventUnlisten(newUnlisten);
}
