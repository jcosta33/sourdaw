import { setMpeEnabled as setWebMidiMpeEnabled } from '../../repositories/webMidi/lifecycle/setMpeEnabled';

export function setMpeEnabled(
    ...args: Parameters<typeof setWebMidiMpeEnabled>
): ReturnType<typeof setWebMidiMpeEnabled> {
    return setWebMidiMpeEnabled(...args);
}