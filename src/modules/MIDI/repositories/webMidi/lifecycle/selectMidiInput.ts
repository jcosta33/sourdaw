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
        void selectMidiInputTauri({ portIndex: Number(deviceId), onMidiMessage });
        setState({ selectedInputId: deviceId });
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
