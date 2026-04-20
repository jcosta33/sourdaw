import { subscribe as subscribeToWebMidiState } from '../../repositories/webMidi/state';

/**
 * Public contract for Web MIDI state and lifecycle operations.
 */
export function subscribe(
    ...args: Parameters<typeof subscribeToWebMidiState>
): ReturnType<typeof subscribeToWebMidiState> {
    return subscribeToWebMidiState(...args);
}
