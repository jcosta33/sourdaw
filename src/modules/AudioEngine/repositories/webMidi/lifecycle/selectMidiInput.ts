import { getMidiAccess, getTauriMode, setState } from '../state';

import { attachInput, selectMidiInputTauri } from './helpers';

export function selectMidiInput(deviceId: string): void {
    if (getTauriMode()) {
        selectMidiInputTauri(Number(deviceId));
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
