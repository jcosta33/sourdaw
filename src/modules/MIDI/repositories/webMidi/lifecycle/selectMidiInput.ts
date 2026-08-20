import { logger } from '#/infra/logger/appLogger';

import { type WebMidiInputMessage } from '../../../models/WebMidiTypes';
import { getMidiAccess } from '../getMidiAccess';
import { getNativeMode } from '../getNativeMode';
import { setState } from '../setState';

import { attachInput } from './helpers';
import { listNativeMidiInputs } from './listNativeMidiInputs';
import { selectMidiInputNative } from './selectMidiInputNative';

type SelectMidiInputInput = {
    deviceId: string;
    onMidiMessage: (event: WebMidiInputMessage) => void;
};

/**
 * Persist only once the port is actually open. Committing the id up front
 * leaves the picker showing — and `localStorage` remembering — a device that
 * `open_midi_input` refused, which then delivers no MIDI and reports nothing.
 * The rejection was also unhandled.
 *
 * The port index is resolved from a fresh enumeration rather than read off the
 * id, because the list the picker was drawn from can be one replug out of date
 * and the index would then open a different instrument (issue #1837 F9).
 */
async function openNativePort({ deviceId, onMidiMessage }: SelectMidiInputInput): Promise<void> {
    try {
        const port = (await listNativeMidiInputs()).find((entry) => entry.id === deviceId);
        if (!port) {
            logger.warn('[MIDI] Requested MIDI input is no longer present:', deviceId);
            return;
        }

        await selectMidiInputNative({ portIndex: port.portIndex, portName: port.name, onMidiMessage });
        setState({ selectedInputId: deviceId });
    } catch (error: unknown) {
        logger.warn('[MIDI] Failed to open MIDI input:', error);
    }
}

export function selectMidiInput({ deviceId, onMidiMessage }: SelectMidiInputInput): void {
    if (getNativeMode()) {
        void openNativePort({ deviceId, onMidiMessage });
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
