import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { type MidiInputInfo, type WebMidiInputMessage } from '../../../models/WebMidiTypes';
import { getMidiAccess } from '../getMidiAccess';
import { getState } from '../getState';
import { readPersistedInputId } from '../readPersistedInputId';
import { setMidiAccess } from '../setMidiAccess';
import { setState } from '../setState';
import { setTauriMode } from '../setTauriMode';
// Side-effect: registers the store sync subscription before any setState below.
import '../store';

import { detachActiveInput } from './detachActiveInput';
import { attachInput } from './helpers';
import { selectMidiInputTauri } from './selectMidiInputTauri';

type TauriMidiDevice = { index: number; name: string };
type WebMidiMessageCallback = (event: WebMidiInputMessage) => void;

function isTauriMidiDevice(value: unknown): value is TauriMidiDevice {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('index' in value) || !('name' in value)) {
        return false;
    }

    return Number.isInteger(value.index) && typeof value.name === 'string';
}

/**
 * The device list arrives over IPC, so it is `unknown` until proven otherwise.
 * A bare cast let a malformed payload through as `id: "undefined"`, which then
 * reached `open_midi_input` as `NaN`. Same guard shape as the message-event
 * validation one file over.
 */
function isTauriMidiDeviceList(value: unknown): value is TauriMidiDevice[] {
    return Array.isArray(value) && value.every(isTauriMidiDevice);
}

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
    const currentAccess = getMidiAccess();
    const preferredId = readPersistedInputId();

    // The saved device came back (replug, hub power cycle). Restore it rather
    // than leaving the session stuck on whatever stood in for it.
    if (preferredId !== null && preferredId !== state.selectedInputId && currentAccess) {
        const preferredInput = currentAccess.inputs.get(preferredId);
        if (preferredInput && inputs.some((entry) => entry.id === preferredId)) {
            detachActiveInput();
            attachInput({ input: preferredInput, onMidiMessage });
            setState({ inputs, selectedInputId: preferredId });
            return;
        }
    }

    const selectedStillExists = inputs.some((index) => index.id === state.selectedInputId);

    if (!selectedStillExists) {
        detachActiveInput();
    }

    if (!selectedStillExists && inputs.length > 0 && currentAccess) {
        const first = inputs[0]!;
        const input = currentAccess.inputs.get(first.id);
        if (input) {
            attachInput({ input, onMidiMessage });
            // Session-only stand-in: the user still prefers the device that
            // was unplugged, so leave the persisted preference alone.
            setState({ inputs, selectedInputId: first.id }, { persistSelection: false });
            return;
        }
    }

    setState(
        {
            inputs,
            selectedInputId: selectedStillExists ? state.selectedInputId : null,
        },
        { persistSelection: false }
    );
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
                    // `state.selectedInputId` is seeded from the saved
                    // preference, so a startup with that device unplugged
                    // resolves it, misses, and falls back. Persisting the
                    // stand-in rebinds the controller for good — and the replug
                    // restore in `onStateChange` cannot undo it, because it only
                    // fires while the saved id differs from the selected one.
                    setState({ selectedInputId: input.id }, { persistSelection: input.id === targetId });
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
            const devices = await tauriInvoke('list_midi_inputs');
            if (!isTauriMidiDeviceList(devices)) {
                throw new TypeError('list_midi_inputs returned an invalid device list');
            }
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
                // Same rule as the Web MIDI path: a stand-in for an absent
                // device is this session's choice, never the saved one.
                setState({ selectedInputId: targetInput.id }, { persistSelection: targetInput.id === targetId });
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
