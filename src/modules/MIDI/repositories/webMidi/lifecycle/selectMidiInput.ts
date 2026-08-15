import { logger } from '#/infra/logger/appLogger';

import { type WebMidiInputMessage } from '../../../models/WebMidiTypes';
import { getMidiAccess } from '../getMidiAccess';
import { getTauriMode } from '../getTauriMode';
import { setState } from '../setState';

import { attachInput } from './helpers';
import { selectMidiInputTauri } from './selectMidiInputTauri';

type SelectMidiInputInput = {
    deviceId: string;
    onMidiMessage: (event: WebMidiInputMessage) => void;
};

/**
 * Persist only once the port is actually open. Committing the id up front
 * leaves the picker showing — and `localStorage` remembering — a device that
 * `open_midi_input` refused, which then delivers no MIDI and reports nothing.
 * The rejection was also unhandled.
 */
async function openTauriPort({ deviceId, onMidiMessage }: SelectMidiInputInput): Promise<void> {
    try {
        await selectMidiInputTauri({ portIndex: Number(deviceId), onMidiMessage });
        setState({ selectedInputId: deviceId });
    } catch (error: unknown) {
        logger.warn('[MIDI] Failed to open MIDI input:', error);
    }
}

export function selectMidiInput({ deviceId, onMidiMessage }: SelectMidiInputInput): void {
    if (getTauriMode()) {
        void openTauriPort({ deviceId, onMidiMessage });
        return;
    }

    const access = getMidiAccess();
    if (!access) {
        return;
    }

    const input = access.inputs.get(deviceId);
    if (!input) {
        return;
    }

    attachInput({ input, onMidiMessage });
    setState({ selectedInputId: deviceId });
}
