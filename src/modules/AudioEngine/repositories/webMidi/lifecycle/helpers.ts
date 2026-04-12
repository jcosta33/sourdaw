import { tauriInvoke } from '#/utils/tauriBridge';
import { getActiveInput, getTauriEventUnlisten, setActiveInput, setTauriEventUnlisten } from '../state';
import { onMidiMessage } from '../messageHandlers';

export function attachInput(input: MIDIInput): void {
    const current = getActiveInput();
    if (current && current !== input) {
        current.removeEventListener('midimessage', onMidiMessage as EventListener);
    }
    setActiveInput(input);
    input.addEventListener('midimessage', onMidiMessage as EventListener);
}

export async function selectMidiInputTauri(portIndex: number): Promise<void> {
    const currentUnlisten = getTauriEventUnlisten();
    if (currentUnlisten) {
        currentUnlisten();
        setTauriEventUnlisten(null);
    }

    const portName = (await tauriInvoke('open_midi_input', { portIndex })) as string;
    portName;

    const { tauriListen } = await import('#/utils/tauriBridge');
    const newUnlisten = (await tauriListen('midi-message', (event) => {
        const payload = event as { payload: { data: number[] } };
        const bytes = payload.payload.data;
        if (!bytes || bytes.length < 2) {
            return;
        }
        const uint8 = new Uint8Array(bytes);
        onMidiMessage({ data: uint8 } as MIDIMessageEvent);
    })) as unknown as () => void;
    setTauriEventUnlisten(newUnlisten);
}