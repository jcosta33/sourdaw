import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { type MidiInputInfo } from '../../../models/WebMidiTypes';
import { getMidiAccess } from '../getMidiAccess';
import { getState } from '../getState';
import { setMidiAccess } from '../setMidiAccess';
import { setState } from '../setState';
import { setTauriMode } from '../setTauriMode';
// Side-effect: registers the store sync subscription before any setState below.
import '../store';

import { detachActiveInput } from './detachActiveInput';
import { attachInput } from './helpers';
import { selectMidiInputTauri } from './selectMidiInputTauri';

type TauriMidiDevice = { index: number; name: string };
type WebMidiMessageCallback = (event: MIDIMessageEvent) => void;

function enumerateInputs(): MidiInputInfo[] {
    const access = getMidiAccess();
    if (!access) {
        return [];
    }
    const entries = Array.from(access.inputs.values());
    return entries.map((input) => ({
        id: input.id,
        name: input.name ?? 'Unknown Device',
        manufacturer: input.manufacturer ?? 'Unknown',
    }));
}

type OnStateChangeInput = {
    onMidiMessage: WebMidiMessageCallback;
};

function onStateChange({ onMidiMessage }: OnStateChangeInput): void {
    const inputs = enumerateInputs();
    const state = getState();
    const selectedStillExists = inputs.some((index) => index.id === state.selectedInputId);

    if (!selectedStillExists) {
        detachActiveInput();
    }

    const currentAccess = getMidiAccess();
    if (!selectedStillExists && inputs.length > 0 && currentAccess) {
        const first = inputs[0]!;
        const input = currentAccess.inputs.get(first.id);
        if (input) {
            attachInput({ input, onMidiMessage });
            setState({ inputs, selectedInputId: first.id });
            return;
        }
    }

    setState({
        inputs,
        selectedInputId: selectedStillExists ? state.selectedInputId : null,
    });
}

type InitWebMidiInput = {
    onMidiMessage: WebMidiMessageCallback;
};

export async function initWebMidi({ onMidiMessage }: InitWebMidiInput): Promise<boolean> {
    const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    const state = getState();

    if (!state.isSupported) {
        logger.warn('[MIDI] MIDI not supported');
        return false;
    }

    if (webMidiSupported) {
        try {
            const access = await navigator.requestMIDIAccess({ sysex: false });
            setMidiAccess(access);
            access.onstatechange = () => onStateChange({ onMidiMessage });

            const inputs = enumerateInputs();
            setState({ inputs });

            if (inputs.length > 0) {
                // Always (re-)attach: covers first load AND re-init after page
                // navigation where selectedInputId may already be set but
                // the onmidimessage handler was never wired to this access object.
                const targetId = state.selectedInputId ?? inputs[0]!.id;
                const input = access.inputs.get(targetId) ?? access.inputs.get(inputs[0]!.id);
                if (input) {
                    attachInput({ input, onMidiMessage });
                    setState({ selectedInputId: input.id });
                }
            }

            return true;
        } catch (error) {
            logger.warn('[MIDI] Web MIDI failed, trying Tauri fallback:', error);
        }
    }

    if (isTauri()) {
        try {
            setTauriMode(true);
            const devices = (await tauriInvoke('list_midi_inputs')) as TauriMidiDevice[];
            const inputs: MidiInputInfo[] = devices.map((data) => ({
                id: String(data.index),
                name: data.name,
                manufacturer: 'System',
            }));
            setState({ inputs, isSupported: true });

            if (inputs.length > 0) {
                // Always (re-)open: covers first load AND re-init after app
                // restart where selectedInputId is persisted in localStorage but
                // the Tauri IPC port has NOT been opened yet for this session.
                const targetId = state.selectedInputId ?? inputs[0]!.id;
                const targetInput = inputs.find((index) => index.id === targetId) ?? inputs[0]!;
                await selectMidiInputTauri({ portIndex: Number(targetInput.id), onMidiMessage });
                setState({ selectedInputId: targetInput.id });
            }

            return true;
        } catch (error) {
            logger.warn('[MIDI] Tauri MIDI init failed:', error);
            setState({ isSupported: false });
            return false;
        }
    }

    setState({ isSupported: false });
    return false;
}
