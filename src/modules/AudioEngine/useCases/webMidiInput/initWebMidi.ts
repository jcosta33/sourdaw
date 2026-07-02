import { initWebMidi as initializeWebMidi } from '../../repositories/webMidi/lifecycle/initWebMidi';

import { handleWebMidiMessage } from './handleWebMidiMessage';

export function initWebMidi(): ReturnType<typeof initializeWebMidi> {
    return initializeWebMidi({ onMidiMessage: handleWebMidiMessage });
}
