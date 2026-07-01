import { getMidiAccess, getTauriMode, setState } from '../state';

import { attachInput } from './helpers';
import { selectMidiInputTauri } from './selectMidiInputTauri';

export function selectMidiInput(deviceId: string): void {
    if (getTauriMode()) {
        void selectMidiInputTauri(Number(deviceId));
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

    attachInput(input);
    setState({ selectedInputId: deviceId });
}
