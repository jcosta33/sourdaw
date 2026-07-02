import { selectMidiInput as chooseMidiInput } from '../../repositories/webMidi/lifecycle/selectMidiInput';

import { handleWebMidiMessage } from './handleWebMidiMessage';

export function selectMidiInput(deviceId: string): ReturnType<typeof chooseMidiInput> {
    return chooseMidiInput({ deviceId, onMidiMessage: handleWebMidiMessage });
}
