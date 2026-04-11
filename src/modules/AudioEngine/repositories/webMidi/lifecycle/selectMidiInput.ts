import { midiAccess, tauriMode, setState } from '../state';
import { attachInput, selectMidiInputTauri } from './helpers';

export function selectMidiInput(deviceId: string): void {
    if (tauriMode) {
        selectMidiInputTauri(Number(deviceId));
        setState({ selectedInputId: deviceId });
        return;
    }

    if (!midiAccess) {
        return;
    }

    const input = midiAccess.inputs.get(deviceId);
    if (!input) {
        return;
    }

    attachInput(input);
    setState({ selectedInputId: deviceId });
}