import { selectMidiInput as chooseMidiInput } from '../../repositories/webMidi/lifecycle/selectMidiInput';

export function selectMidiInput(...args: Parameters<typeof chooseMidiInput>): ReturnType<typeof chooseMidiInput> {
    return chooseMidiInput(...args);
}
