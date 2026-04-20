import { initWebMidi as initializeWebMidi } from '../../repositories/webMidi/lifecycle/initWebMidi';

export function initWebMidi(...args: Parameters<typeof initializeWebMidi>): ReturnType<typeof initializeWebMidi> {
    return initializeWebMidi(...args);
}
