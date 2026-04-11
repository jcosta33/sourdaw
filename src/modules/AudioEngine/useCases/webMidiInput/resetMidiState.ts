import { resetMidiState as resetWebMidiState } from '../../repositories/webMidi/lifecycle/resetMidiState';

export function resetMidiState(
    ...args: Parameters<typeof resetWebMidiState>
): ReturnType<typeof resetWebMidiState> {
    return resetWebMidiState(...args);
}