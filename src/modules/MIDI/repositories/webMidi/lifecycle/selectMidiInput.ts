import { logger } from '#/infra/logger/appLogger';

import { getMidiAccess } from '../getMidiAccess';
import { getTauriMode } from '../getTauriMode';
import { setState } from '../setState';

import { attachInput } from './helpers';
import { selectMidiInputTauri } from './selectMidiInputTauri';

type SelectMidiInputInput = {
    deviceId: string;
    onMidiMessage: (event: MIDIMessageEvent) => void;
};

export function selectMidiInput({ deviceId, onMidiMessage }: SelectMidiInputInput): void {
    if (getTauriMode()) {
        // Persist only once the port is actually open. Committing the id up
        // front leaves the picker showing — and `localStorage` remembering — a
        // device that `open_midi_input` refused, which then delivers no MIDI
        // and reports nothing. The rejection was also unhandled.
        void selectMidiInputTauri({ portIndex: Number(deviceId), onMidiMessage })
            .then(() => {
                setState({ selectedInputId: deviceId });
            })
            .catch((error: unknown) => {
                logger.warn('[MIDI] Failed to open MIDI input:', error);
            });
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
